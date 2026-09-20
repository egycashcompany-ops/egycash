// Reading a grant back as a level — the three shapes of fleet authority, told apart.
//
// The same three the delegation tests use, because they are the three the company actually has and
// the difference between them is the whole rule: «مدير عام الحركة» holds الحركة in every branch,
// «مدير حركة المهندسين» holds it in one, and «مدير فرع المهندسين» holds the branch with every
// department in it. A chain that confuses any two of them routes a request past somebody.
import { describe, expect, it } from 'vitest';
import {
  delegationMeetsLevel,
  grantMeetsLevel,
  type GrantShape,
  type Unit,
} from './approver-level';

const FLEET = 'cat-fleet';
const SECURITY = 'cat-security';
const MOH = 'br-moh';
const OCT = 'br-oct';
const FLEET_IN_MOH = 'dep-fleet-moh';

const UNIT: Unit = { branchId: MOH, departmentCatalogId: FLEET, departmentId: FLEET_IN_MOH };

const grant = (over: Partial<GrantShape>): GrantShape => ({
  scope: 'department',
  branchId: null,
  branchIds: [],
  departmentCatalogId: null,
  departmentId: null,
  allBranches: false,
  ...over,
});

const generalFleetManager = grant({ departmentCatalogId: FLEET, allBranches: true });
const fleetManagerMoh = grant({ departmentCatalogId: FLEET, branchId: MOH });
const branchManagerMoh = grant({ scope: 'branch', branchId: MOH });
const hr = grant({ scope: 'organization' });

describe('the three shapes of authority, told apart', () => {
  it('puts the general manager on the department rung and nowhere else', () => {
    expect(grantMeetsLevel(generalFleetManager, 'department', UNIT)).toBe(true);
    expect(grantMeetsLevel(generalFleetManager, 'unit', UNIT)).toBe(false);
    expect(grantMeetsLevel(generalFleetManager, 'branch', UNIT)).toBe(false);
    expect(grantMeetsLevel(generalFleetManager, 'organization', UNIT)).toBe(false);
  });

  it('puts the branch-level fleet manager on the unit rung and nowhere else', () => {
    expect(grantMeetsLevel(fleetManagerMoh, 'unit', UNIT)).toBe(true);
    expect(grantMeetsLevel(fleetManagerMoh, 'department', UNIT)).toBe(false);
    expect(grantMeetsLevel(fleetManagerMoh, 'branch', UNIT)).toBe(false);
  });

  it('puts the branch holder on the branch rung, for any department in his branch', () => {
    expect(grantMeetsLevel(branchManagerMoh, 'branch', UNIT)).toBe(true);
    expect(
      grantMeetsLevel(branchManagerMoh, 'branch', { ...UNIT, departmentCatalogId: SECURITY }),
    ).toBe(true);
    expect(grantMeetsLevel(branchManagerMoh, 'unit', UNIT)).toBe(false);
  });

  it('puts the company-wide holder on the organization rung only', () => {
    expect(grantMeetsLevel(hr, 'organization', UNIT)).toBe(true);
    expect(grantMeetsLevel(hr, 'branch', UNIT)).toBe(false);
    expect(grantMeetsLevel(hr, 'unit', UNIT)).toBe(false);
  });
});

describe('a grant that does not reach the request', () => {
  it('does not count in a branch it was never given', () => {
    const unitInOctober: Unit = { ...UNIT, branchId: OCT };
    expect(grantMeetsLevel(fleetManagerMoh, 'unit', unitInOctober)).toBe(false);
    expect(grantMeetsLevel(branchManagerMoh, 'branch', unitInOctober)).toBe(false);
    // …while the general manager reaches every branch, which is what makes him general.
    expect(grantMeetsLevel(generalFleetManager, 'department', unitInOctober)).toBe(true);
  });

  it('does not count in a department it was never given', () => {
    const security: Unit = { ...UNIT, departmentCatalogId: SECURITY, departmentId: 'dep-sec-moh' };
    expect(grantMeetsLevel(fleetManagerMoh, 'unit', security)).toBe(false);
    expect(grantMeetsLevel(generalFleetManager, 'department', security)).toBe(false);
  });

  it('counts a branch added to the holder’s own, not only the one he sits in', () => {
    const alsoOctober = grant({ departmentCatalogId: FLEET, branchId: MOH, branchIds: [OCT] });
    expect(grantMeetsLevel(alsoOctober, 'unit', { ...UNIT, branchId: OCT })).toBe(true);
  });

  it('answers nothing for a request with no branch at all, except at the company level', () => {
    const nowhere: Unit = { branchId: null, departmentCatalogId: FLEET, departmentId: null };
    expect(grantMeetsLevel(fleetManagerMoh, 'unit', nowhere)).toBe(false);
    expect(grantMeetsLevel(branchManagerMoh, 'branch', nowhere)).toBe(false);
    expect(grantMeetsLevel(hr, 'organization', nowhere)).toBe(true);
  });
});

describe('a grant written before the department catalog existed', () => {
  it('is read against the branch’s own copy of the department', () => {
    const old = grant({ departmentId: FLEET_IN_MOH, branchId: MOH });
    expect(grantMeetsLevel(old, 'unit', UNIT)).toBe(true);
    expect(grantMeetsLevel(old, 'unit', { ...UNIT, departmentId: 'dep-fleet-oct', branchId: OCT })).toBe(
      false,
    );
  });
});

describe('a delegated grant', () => {
  it('stands on the unit rung when it names the department, and the branch rung when it does not', () => {
    expect(delegationMeetsLevel({ branchId: MOH, departmentId: FLEET_IN_MOH }, 'unit', UNIT)).toBe(true);
    expect(delegationMeetsLevel({ branchId: MOH, departmentId: null }, 'branch', UNIT)).toBe(true);
  });

  it('never reaches the two levels a delegation cannot express', () => {
    // Nobody hands down «in every branch» or «the whole company» — those an administrator assigns.
    expect(delegationMeetsLevel({ branchId: MOH, departmentId: FLEET_IN_MOH }, 'department', UNIT)).toBe(
      false,
    );
    expect(delegationMeetsLevel({ branchId: MOH, departmentId: null }, 'organization', UNIT)).toBe(false);
  });

  it('does not cross into another branch or another department', () => {
    expect(delegationMeetsLevel({ branchId: OCT, departmentId: FLEET_IN_MOH }, 'unit', UNIT)).toBe(false);
    expect(delegationMeetsLevel({ branchId: MOH, departmentId: 'dep-sec-moh' }, 'unit', UNIT)).toBe(false);
  });
});
