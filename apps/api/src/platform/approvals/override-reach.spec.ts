// How far `approval.override` reaches, rung by rung (R4, PX-1.2 of
// docs/12-planning/administration-module-phase-px1.md §6.2; ADR-041 decision 6).
//
// Every way this is wrong is quiet: an override held over one branch that decides a rung for the
// whole company, or one that passes a department rung on a request with no department, approves
// with a name and a reason on it, and nobody reads the trail to see that the reach did not match.
// So each level is checked against each shape of grant, reaching and not, and each coordinate a
// level needs is checked missing.
import { describe, expect, it } from 'vitest';
import { type ApprovalLevel, type DataScope } from '@ecms/contracts';
import { type AuthContext, type UnitReach } from '../../shared/types';
import { type Unit } from './approver-level';
import { APPROVAL_OVERRIDE_KEY, overrideReaches } from './override-reach';

const BRANCH = 'branch-heliopolis';
const OTHER_BRANCH = 'branch-october';
const CATALOG = 'catalog-fleet';
const OTHER_CATALOG = 'catalog-security';
/** «الحركة» in this branch, and in the other one: two copies of one company-wide department. */
const COPY_HERE = 'department-fleet-heliopolis';
const COPY_THERE = 'department-fleet-october';

/** The request: الحركة in مصر الجديدة. */
const UNIT: Unit = { branchId: BRANCH, departmentCatalogId: CATALOG, departmentId: COPY_HERE };

const holder = (scope: DataScope | null, over: Partial<AuthContext> = {}): AuthContext => ({
  userId: 'u-overrider',
  sessionId: 'spec',
  branchId: null,
  departmentId: null,
  sectionId: null,
  locale: 'ar',
  permissions: scope === null ? {} : { [APPROVAL_OVERRIDE_KEY]: scope },
  permissionVersion: 1,
  isPrivileged: false,
  ...over,
});
const reaching = (reach: UnitReach): Pick<AuthContext, 'keyReach'> => ({
  keyReach: { [APPROVAL_OVERRIDE_KEY]: reach },
});

/** The shapes an override grant takes, as the permission layer resolves them (ADR-032). */
const GRANTS = {
  organization: holder('organization'),
  'branch, its home': holder('branch', { branchId: BRANCH }),
  'branch, listed': holder(
    'branch',
    reaching({ branchIds: [OTHER_BRANCH, BRANCH], departments: [] }),
  ),
  'branch, another': holder('branch', { branchId: OTHER_BRANCH }),
  'department in every branch': holder(
    'department',
    reaching({
      branchIds: [],
      departments: [
        { id: COPY_HERE, branchId: BRANCH },
        { id: COPY_THERE, branchId: OTHER_BRANCH },
      ],
      everywhere: [CATALOG],
    }),
  ),
  'another department in every branch': holder(
    'department',
    reaching({
      branchIds: [],
      departments: [{ id: 'department-security-heliopolis', branchId: BRANCH }],
      everywhere: [OTHER_CATALOG],
    }),
  ),
  'department in this branch': holder(
    'department',
    reaching({ branchIds: [], departments: [{ id: COPY_HERE, branchId: BRANCH }] }),
  ),
  'department in this branch, its home': holder('department', {
    branchId: BRANCH,
    departmentId: COPY_HERE,
  }),
  'department in another branch': holder(
    'department',
    reaching({ branchIds: [], departments: [{ id: COPY_THERE, branchId: OTHER_BRANCH }] }),
  ),
} satisfies Record<string, AuthContext>;
type Grant = keyof typeof GRANTS;

const LEVELS: readonly ApprovalLevel[] = ['unit', 'department', 'branch', 'organization'];

/** Which grants reach a rung of each level over UNIT. Every other grant must not. */
const REACHES: Record<ApprovalLevel, readonly Grant[]> = {
  organization: ['organization'],
  department: ['organization', 'department in every branch'],
  branch: ['organization', 'branch, its home', 'branch, listed'],
  unit: [
    'organization',
    'branch, its home',
    'branch, listed',
    'department in every branch',
    'department in this branch',
    'department in this branch, its home',
  ],
};

describe('each level against each shape of grant', () => {
  it.each(LEVELS)('the %s level is reached by exactly the grants that reach that far', (level) => {
    for (const [name, ctx] of Object.entries(GRANTS) as [Grant, AuthContext][]) {
      expect(overrideReaches(ctx, level, UNIT), `${name}, ${level} level`).toBe(
        REACHES[level].includes(name),
      );
    }
  });

  it('refuses own, section and an unheld override on every level', () => {
    // `own` and `section` reach no Unit, wherever the holder is placed.
    const placed = { branchId: BRANCH, departmentId: COPY_HERE, sectionId: 'section-garage' };
    for (const level of LEVELS) {
      for (const ctx of [holder('own', placed), holder('section', placed), holder(null, placed)]) {
        expect(overrideReaches(ctx, level, UNIT), level).toBe(false);
      }
    }
  });

  it('reads the override key’s own reach, not another key’s', () => {
    // The holder reaches this branch with some other key only; the override reaches the home
    // branch elsewhere, and that is all it reaches.
    const ctx = holder('branch', {
      branchId: OTHER_BRANCH,
      keyReach: { 'leave.view': { branchIds: [BRANCH], departments: [] } },
    });
    expect(overrideReaches(ctx, 'branch', UNIT)).toBe(false);
  });
});

describe('a coordinate the rung’s level needs, when the Unit lacks it', () => {
  it('fails a department rung closed without the company department', () => {
    const unit: Unit = { ...UNIT, departmentCatalogId: null };
    expect(overrideReaches(GRANTS['department in every branch'], 'department', unit)).toBe(false);
  });

  it('fails a branch rung closed without the branch', () => {
    const unit: Unit = { ...UNIT, branchId: null };
    expect(overrideReaches(GRANTS['branch, its home'], 'branch', unit)).toBe(false);
    expect(overrideReaches(GRANTS['branch, listed'], 'branch', unit)).toBe(false);
  });

  it('fails a unit rung closed without the branch, even for an override over that very copy', () => {
    // The reach helper matches a department copy by its id alone, so without this check the copy's
    // holder would pass a rung whose branch is not known.
    const unit: Unit = { ...UNIT, branchId: null };
    expect(overrideReaches(GRANTS['department in this branch'], 'unit', unit)).toBe(false);
    expect(overrideReaches(GRANTS['department in every branch'], 'unit', unit)).toBe(false);
  });

  it('fails a unit rung closed without the branch’s department copy, for a branch-wide override too', () => {
    // The reach helper reads a missing copy as a question about the whole branch, which a
    // branch-wide override answers yes to. A `unit` rung asks about one department, so it is no.
    const unit: Unit = { ...UNIT, departmentId: null };
    expect(overrideReaches(GRANTS['branch, its home'], 'unit', unit)).toBe(false);
    expect(overrideReaches(GRANTS['branch, listed'], 'unit', unit)).toBe(false);
    expect(overrideReaches(GRANTS['department in this branch'], 'unit', unit)).toBe(false);
  });

  it('lets organization scope pass every level, whatever the Unit lacks', () => {
    const nowhere: Unit = { branchId: null, departmentCatalogId: null, departmentId: null };
    for (const level of LEVELS) {
      expect(overrideReaches(GRANTS.organization, level, nowhere), level).toBe(true);
    }
  });
});
