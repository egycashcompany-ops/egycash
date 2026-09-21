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
  type DelegationShape,
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

const handedDown = (over: Partial<DelegationShape>): DelegationShape => ({
  branchId: null,
  departmentId: null,
  departmentCatalogId: null,
  allBranches: false,
  ...over,
});

/** «الحركة في المهندسين» — one department, one branch. */
const inOneUnit = handedDown({ branchId: MOH, departmentId: FLEET_IN_MOH });
/** «فرع المهندسين كله». */
const wholeBranch = handedDown({ branchId: MOH });
/** «الحركة في كل الفروع» — the deputy a general manager appoints. */
const everywhere = handedDown({ departmentCatalogId: FLEET, allBranches: true });

describe('a delegated grant', () => {
  it('stands on the unit rung when it names the department, and the branch rung when it does not', () => {
    expect(delegationMeetsLevel(inOneUnit, 'unit', UNIT)).toBe(true);
    expect(delegationMeetsLevel(wholeBranch, 'branch', UNIT)).toBe(true);
  });

  it('never reaches the one level a delegation cannot express', () => {
    // Nobody hands down the whole company — that one an administrator assigns.
    expect(delegationMeetsLevel(inOneUnit, 'organization', UNIT)).toBe(false);
    expect(delegationMeetsLevel(wholeBranch, 'organization', UNIT)).toBe(false);
    expect(delegationMeetsLevel(everywhere, 'organization', UNIT)).toBe(false);
  });

  it('does not cross into another branch or another department', () => {
    expect(delegationMeetsLevel(handedDown({ branchId: OCT, departmentId: FLEET_IN_MOH }), 'unit', UNIT)).toBe(false);
    expect(delegationMeetsLevel(handedDown({ branchId: MOH, departmentId: 'dep-sec-moh' }), 'unit', UNIT)).toBe(false);
  });

  // «هيدى نفس اللى هو ماسك، ليه، نايب يعتبر» — the deputy stands exactly where the general
  // manager stands, and a chain that could not find him would step over that rung and send the
  // request past him to HR. Silently, which is the whole danger.
  it('puts the deputy handed «الحركة في كل الفروع» on the general manager’s own rung', () => {
    expect(delegationMeetsLevel(everywhere, 'department', UNIT)).toBe(true);
    expect(delegationMeetsLevel(everywhere, 'department', { ...UNIT, branchId: OCT })).toBe(true);
  });

  it('keeps that deputy OFF the rung below his, so one person never answers two rungs', () => {
    expect(delegationMeetsLevel(everywhere, 'unit', UNIT)).toBe(false);
    expect(delegationMeetsLevel(everywhere, 'branch', UNIT)).toBe(false);
  });

  it('follows the department, not the branch — and no further', () => {
    expect(
      delegationMeetsLevel(everywhere, 'department', { ...UNIT, departmentCatalogId: SECURITY }),
    ).toBe(false);
    // A request with no branch still has a department, and that is all this shape reads.
    expect(
      delegationMeetsLevel(everywhere, 'department', { ...UNIT, branchId: null, departmentId: null }),
    ).toBe(true);
  });
});
