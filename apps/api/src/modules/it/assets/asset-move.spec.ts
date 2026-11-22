// «نقل إلى فرع» — «عايز إمكانية نقل أصل … إلى فرع تاني» — pinned where it is pure: which asset may
// move, how ONE refusal names every asset holding the move back, and what the move answers.
import { describe, expect, it } from 'vitest';
import { BusinessRuleError, ConflictError } from '../../../shared/errors';
import {
  assetMoveRefusal,
  assetMoveRefusalError,
  assetsBranchMoveResult,
  moveTargetBranchIds,
} from './asset-move';

const HERE = '6563a1b2c3d4e5f601020301';
const THERE = '6563a1b2c3d4e5f601020302';
/** The move's date. */
const AT = new Date('2026-11-11T09:00:00.000Z');

const candidate = (over: Partial<Parameters<typeof assetMoveRefusal>[0]> = {}) => ({
  status: 'inStock' as const,
  branchId: HERE,
  activeMaintenance: false,
  heldSince: null,
  ...over,
});

/** The refusal of one asset, moved on `AT`. */
const refusal = (over: Partial<Parameters<typeof assetMoveRefusal>[0]>, to: string) =>
  assetMoveRefusal(candidate(over), to, AT);

describe('which asset may move', () => {
  it('one in stock, and one an employee holds — it moves with its custody («ينتقل مع عهدته»)', () => {
    expect(refusal({}, THERE)).toBeNull();
    expect(refusal({ status: 'assigned', heldSince: new Date('2026-01-01') }, THERE)).toBeNull();
  });

  it('never a disposed one — terminal (FR-4)', () => {
    expect(refusal({ status: 'disposed' }, THERE)).toBe('disposed');
  });

  it('never one under maintenance — by its status, or by an open order whatever its status says', () => {
    expect(refusal({ status: 'underMaintenance' }, THERE)).toBe('underMaintenance');
    expect(refusal({ activeMaintenance: true }, THERE)).toBe('underMaintenance');
    expect(refusal({ status: 'assigned', activeMaintenance: true }, THERE)).toBe(
      'underMaintenance',
    );
  });

  it('never to the branch it is already in — that moves nothing', () => {
    expect(refusal({}, HERE)).toBe('alreadyThere');
    expect(refusal({ status: 'assigned' }, HERE)).toBe('alreadyThere');
  });

  it('never a held one dated before its custody began — the move closes that interval', () => {
    expect(refusal({ status: 'assigned', heldSince: new Date('2026-11-12') }, THERE)).toBe(
      'beforeCustody',
    );
    // The very instant it was received is no earlier than it.
    expect(refusal({ status: 'assigned', heldSince: AT }, THERE)).toBeNull();
  });

  it('names the weightiest reason when several hold: disposed, maintenance, where it is, the date', () => {
    expect(refusal({ status: 'disposed', activeMaintenance: true }, HERE)).toBe('disposed');
    expect(refusal({ activeMaintenance: true }, HERE)).toBe('underMaintenance');
    expect(refusal({ status: 'assigned', heldSince: new Date('2026-11-12') }, HERE)).toBe(
      'alreadyThere',
    );
  });

  it('never one a department holds at a place of its branch — a place does not travel (2026-11-19)', () => {
    const department = { status: 'assigned' as const, heldByDepartment: true };
    expect(refusal({ ...department, heldSince: new Date('2026-01-01') }, THERE)).toBe(
      'heldAtLocation',
    );
    // After where it already is, before the date the move gives.
    expect(refusal({ ...department, heldSince: null }, HERE)).toBe('alreadyThere');
    expect(refusal({ ...department, heldSince: new Date('2026-11-12') }, THERE)).toBe(
      'heldAtLocation',
    );
    expect(refusal({ ...department, activeMaintenance: true }, THERE)).toBe('underMaintenance');
    // An employee's custody still moves with them — false, or not said at all.
    expect(refusal({ status: 'assigned', heldByDepartment: false }, THERE)).toBeNull();
  });
});

describe('a refused move', () => {
  it('is no refusal at all when every asset may move', () => {
    expect(assetMoveRefusalError([])).toBeNull();
  });

  it('names EVERY asset holding it back, by reason — not the first one found', () => {
    const error = assetMoveRefusalError([
      { assetCode: 'AST-00007', reason: 'alreadyThere' },
      { assetCode: 'AST-00003', reason: 'disposed' },
      { assetCode: 'AST-00008', reason: 'beforeCustody' },
      { assetCode: 'AST-00009', reason: 'disposed' },
      { assetCode: 'AST-00005', reason: 'underMaintenance' },
      { assetCode: 'AST-00010', reason: 'beforeCustody' },
    ]);
    expect(error).toBeInstanceOf(BusinessRuleError);
    expect(error?.message).toBe(
      'nothing was moved: assets AST-00003, AST-00009 are disposed; a disposed asset accepts no further operation (FR-4); ' +
        'asset AST-00005 is under maintenance; complete or cancel its maintenance order before you move it; ' +
        'asset AST-00007 is already in that branch; ' +
        "assets AST-00008, AST-00010 are held only since after the move's date; the move cannot precede the assignment it closes",
    );
  });

  it('names a department-held asset in its place in the order — and how it moves instead', () => {
    expect(
      assetMoveRefusalError([
        { assetCode: 'AST-00011', reason: 'beforeCustody' },
        { assetCode: 'AST-00012', reason: 'heldAtLocation' },
        { assetCode: 'AST-00013', reason: 'alreadyThere' },
      ])?.message,
    ).toBe(
      'nothing was moved: asset AST-00013 is already in that branch; ' +
        'asset AST-00012 is held by a department at a place in its branch; move it with «نقل» to a place in the new branch, or return it first; ' +
        "asset AST-00011 is held only since after the move's date; the move cannot precede the assignment it closes",
    );
  });

  it('is a rule (422) for a disposed asset, one already there, one a department holds, or a date before its custody — as custody refuses them', () => {
    for (const reason of ['disposed', 'alreadyThere', 'heldAtLocation', 'beforeCustody'] as const) {
      expect(assetMoveRefusalError([{ assetCode: 'AST-1', reason }])?.httpStatus).toBe(422);
    }
  });

  it('is a conflict (409) when only a maintenance order holds it — custody’s own answer', () => {
    const error = assetMoveRefusalError([
      { assetCode: 'AST-1', reason: 'underMaintenance' },
      { assetCode: 'AST-2', reason: 'underMaintenance' },
    ]);
    expect(error).toBeInstanceOf(ConflictError);
    expect(error?.httpStatus).toBe(409);
    // …and a rule as soon as anything else is wrong too: dropping the asset under maintenance would
    // still not let the request through.
    expect(
      assetMoveRefusalError([
        { assetCode: 'AST-1', reason: 'underMaintenance' },
        { assetCode: 'AST-2', reason: 'alreadyThere' },
      ])?.httpStatus,
    ).toBe(422);
  });
});

describe('what a move answers', () => {
  it('each asset in the order the request named it — where it came from, and who still holds it', () => {
    const moved = [
      {
        assetId: 'a2',
        assetCode: 'AST-00002',
        fromBranchId: HERE,
        toBranchId: THERE,
        holderEmployeeId: 'e1',
      },
      {
        assetId: 'a1',
        assetCode: 'AST-00001',
        fromBranchId: HERE,
        toBranchId: THERE,
        holderEmployeeId: null,
      },
    ];
    expect(assetsBranchMoveResult(THERE, moved)).toEqual({ toBranchId: THERE, moved });
  });

  it('carries no field the contract does not name', () => {
    const result = assetsBranchMoveResult(THERE, [
      {
        assetId: 'a1',
        assetCode: 'AST-00001',
        fromBranchId: HERE,
        toBranchId: THERE,
        holderEmployeeId: null,
        extra: 'not answered',
      } as never,
    ]);
    expect(Object.keys(result.moved[0] ?? {})).toEqual([
      'assetId',
      'assetCode',
      'fromBranchId',
      'toBranchId',
      'holderEmployeeId',
    ]);
  });
});

describe('where a move may go — the branches `itAsset.assign` reaches, as the server judges them', () => {
  const ELSEWHERE = '6563a1b2c3d4e5f601020303';
  const CLOSED = '6563a1b2c3d4e5f601020304';
  const DEPARTMENT = '6563a1b2c3d4e5f601020399';
  /** The organisation's branches, in the branch options' order — one of them closed. */
  const BRANCHES = [
    { id: HERE, status: 'active' as const },
    { id: CLOSED, status: 'inactive' as const },
    { id: THERE, status: 'active' as const },
    { id: ELSEWHERE, status: 'active' as const },
  ];
  /** A caller placed in HERE's department, holding the custody grant at `held`. */
  const caller = (held: string, over: Record<string, unknown> = {}) =>
    ({
      userId: 'u1',
      branchId: HERE,
      departmentId: DEPARTMENT,
      sectionId: null,
      permissions: { 'itAsset.view': 'organization', 'itAsset.assign': held },
      ...over,
    }) as never;

  it('organization-wide: every active branch, in the order given', () => {
    expect(moveTargetBranchIds(caller('organization'), 'itAsset.assign', BRANCHES)).toEqual([
      HERE,
      THERE,
      ELSEWHERE,
    ]);
  });

  it('branch-scoped: their own branch — even when their OTHER grants reach further', () => {
    // The account's reach (every grant) spans three branches; this key's own reach is home alone.
    const wider = {
      reach: { branchIds: [HERE, THERE, ELSEWHERE], departments: [] },
      keyReach: { 'itAsset.view': { branchIds: [HERE, THERE, ELSEWHERE], departments: [] } },
    };
    expect(moveTargetBranchIds(caller('branch'), 'itAsset.assign', BRANCHES)).toEqual([HERE]);
    expect(moveTargetBranchIds(caller('branch', wider), 'itAsset.assign', BRANCHES)).toEqual([
      HERE,
    ]);
  });

  it('branch-scoped over several branches: exactly the ones this key reaches', () => {
    const reach = { branchIds: [HERE, ELSEWHERE], departments: [] };
    expect(
      moveTargetBranchIds(
        caller('branch', { keyReach: { 'itAsset.assign': reach } }),
        'itAsset.assign',
        BRANCHES,
      ),
    ).toEqual([HERE, ELSEWHERE]);
  });

  it('department-scoped: none — a department is never a whole branch, and the move would refuse it', () => {
    expect(moveTargetBranchIds(caller('department'), 'itAsset.assign', BRANCHES)).toEqual([]);
    const departments = [
      { id: DEPARTMENT, branchId: HERE },
      { id: 'd2', branchId: THERE },
    ];
    expect(
      moveTargetBranchIds(
        caller('department', { keyReach: { 'itAsset.assign': { branchIds: [], departments } } }),
        'itAsset.assign',
        BRANCHES,
      ),
    ).toEqual([]);
  });

  it('nobody without the grant, or holding it only over their own records or section', () => {
    expect(moveTargetBranchIds(caller('own'), 'itAsset.assign', BRANCHES)).toEqual([]);
    expect(moveTargetBranchIds(caller('section'), 'itAsset.assign', BRANCHES)).toEqual([]);
    const without = { permissions: { 'itAsset.view': 'organization' } };
    expect(
      moveTargetBranchIds(caller('organization', without), 'itAsset.assign', BRANCHES),
    ).toEqual([]);
  });

  it('never an inactive branch — not even the caller’s own', () => {
    const closedHome = { branchId: CLOSED };
    expect(moveTargetBranchIds(caller('organization'), 'itAsset.assign', BRANCHES)).not.toContain(
      CLOSED,
    );
    expect(moveTargetBranchIds(caller('branch', closedHome), 'itAsset.assign', BRANCHES)).toEqual(
      [],
    );
  });

  it('asks the grant it is given — where the bulk upload registers is `itAsset.create`’s reach, not the move’s', () => {
    // Moves anywhere, registers at home: the upload's branches are home alone, the move's every one.
    const registrar = caller('organization', {
      permissions: { 'itAsset.assign': 'organization', 'itAsset.create': 'branch' },
    });
    expect(moveTargetBranchIds(registrar, 'itAsset.create', BRANCHES)).toEqual([HERE]);
    expect(moveTargetBranchIds(registrar, 'itAsset.assign', BRANCHES)).toEqual([
      HERE,
      THERE,
      ELSEWHERE,
    ]);
    // Without the registration grant: nowhere — and never a closed branch with it.
    expect(moveTargetBranchIds(caller('organization'), 'itAsset.create', BRANCHES)).toEqual([]);
    const everywhere = caller('organization', {
      permissions: { 'itAsset.create': 'organization' },
    });
    expect(moveTargetBranchIds(everywhere, 'itAsset.create', BRANCHES)).toEqual([
      HERE,
      THERE,
      ELSEWHERE,
    ]);
  });
});
