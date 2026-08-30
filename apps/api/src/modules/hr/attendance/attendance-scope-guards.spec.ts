// The branch axis across Attendance, held in place by source (design v1.3 §17.2, D12.5/D12.7).
//
// THE FIFTH COPY OF A SPEC THAT HAS CAUGHT THE SAME DEFECT TWICE IN PRODUCTION. Payroll wrote it
// after F-B1-1 survived four phases of review; Recruitment wrote it after F-REQ-1 did the same;
// Training and Performance wrote it before the defect could happen again. Attendance had none —
// until this phase gave it a collection with a branch on it.
//
// The failure is invisible by construction: `BaseRepository.scopeFilter` answers a scope whose
// field is UNDECLARED with an EMPTY filter, `baseFilter` drops the empty clause, and a
// branch-scoped reader is served the whole organization. Nothing fails, nothing warns, and the
// rows that should have been hidden look exactly like rows that do not exist.
//
// Nothing in the type system can require the field — it is optional by design (ADR-017), so finer
// scopes stay opt-in per collection. So it is required HERE, for the collection that carries a
// PLACE, and explicitly NOT required for the ones that do not.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(resolve(HERE, file), 'utf8');
const strip = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

const DEVICE_REPO = strip(read('devices/attendance-device.repository.ts'));
const PUNCH_REPO = strip(read('punches/punch.repository.ts'));
const SHIFT_REPO = strip(read('shifts/shift.repository.ts'));

describe('the device registry declares its branch axis', () => {
  /**
   * A device stands in exactly one branch, and «which devices are here» has a different answer per
   * place. Without the declaration a branch manager would list every device in the company.
   */
  it('declares branchField on the device repository', () => {
    expect(DEVICE_REPO).toContain("branchField: 'branchId'");
  });

  /** A device belongs to no department — the people who walk past it come from several. */
  it('declares no department axis, because a device has none', () => {
    expect(DEVICE_REPO).not.toContain('departmentField');
  });

  /**
   * The import path resolves a device with an UNSCOPED read, deliberately. Narrowing it by
   * whatever scope the importing account happened to hold would quarantine real punches from a
   * real device for a reason nobody could see.
   */
  it('resolves the device for import through a System read', () => {
    expect(DEVICE_REPO).toContain('findByCodeSystem(');
  });
});

/** «No axis» must stay a decision somebody took rather than a line somebody forgot. */
describe('the shift catalog carries no place, and says so', () => {
  it('leaves the shift catalog organization-wide', () => {
    expect(SHIFT_REPO).toContain('super(ShiftModel, {})');
  });
});

/**
 * THE SPLIT THIS PHASE HAD TO MAKE, and the reason it is guarded rather than trusted.
 *
 * `branchIdAtPunch` is EVIDENCE — where the punch physically happened, which D12.7 made the
 * DEVICE's branch. `employeeBranchId` is the reader's AXIS. Before AT-D1 they were the same value,
 * so the repository scoped on the evidence field and nothing looked wrong.
 *
 * Scoping on evidence once they diverge does not fail loudly — it answers a different question:
 * a branch manager gains other branches' people who happened to punch on their wall, and loses
 * their own employee who punched at head office. Both directions are wrong, and neither raises an
 * error. That is precisely the shape a guard has to hold, because review will not see it.
 */
describe('the punch separates its evidence from the reader’s reach', () => {
  it('scopes on the employee branch', () => {
    expect(PUNCH_REPO).toContain("branchField: 'employeeBranchId'");
  });

  it('never scopes on the branch the punch happened in', () => {
    expect(PUNCH_REPO).not.toContain("branchField: 'branchIdAtPunch'");
  });

  /** The axis comes from the employee on BOTH write paths — never from the evidence override. */
  it('stamps the axis from the employee wherever a punch is written', () => {
    const service = strip(read('punches/punch.service.ts'));
    expect(service).toContain('employeeBranchId: employee.employment.branchId');
    expect(service).toContain('employeeBranchId: employee.branchId');
    expect(service).not.toContain('employeeBranchId: device.branchId');
  });

  /** And the evidence comes from the DEVICE on the import path — D12.7's whole point. */
  it('stamps the evidence from the device on import', () => {
    const service = strip(read('punches/punch.service.ts'));
    expect(service).toContain('branchIdAtPunch: device.branchId');
  });
});

/** D12.5 — an unregistered or retired device is refused with a reason, never accepted blindly. */
describe('import resolves the device before it trusts the row', () => {
  const service = () => strip(read('punches/punch.service.ts'));

  it('quarantines an unknown device instead of storing an unplaceable punch', () => {
    expect(service()).toContain('unknown deviceId');
  });

  it('quarantines a deactivated device', () => {
    expect(service()).toContain('is deactivated');
  });

  it('resolves each distinct device once, not once per row', () => {
    expect(service()).toContain('byDevice');
  });
});
