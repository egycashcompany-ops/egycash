// What a draft on the approval-chain screen names as the chain it replaces (R9, PX-1.6 of
// docs/12-planning/administration-module-phase-px1.md §6.7). A save is refused as stale unless it
// names the place's row as the screen listed it, by id and version, or null where it listed none.
import { describe, expect, it } from 'vitest';
import { type ApprovalWorkflowDto } from '@ecms/contracts';
import { basisAt, basisOf, placed } from './chain-basis';

const FLEET = { id: 'dc-fleet', name: { ar: 'الحركة', en: 'Fleet' } };
const HQ = { id: 'b-hq', name: { ar: 'المركز', en: 'HQ' } };

const listed = (
  id: string,
  requestType: string,
  department: ApprovalWorkflowDto['department'],
  branch: ApprovalWorkflowDto['branch'],
  version: number,
): ApprovalWorkflowDto => ({
  id,
  requestType,
  department,
  branch,
  steps: [{ permissionKey: 'leave.approve', level: 'organization', label: null }],
  isActive: true,
  version,
  updatedAt: '2026-11-25T09:00:00.000Z',
});

const ROWS = [
  listed('w-default', 'hr.leave', null, null, 4),
  listed('w-fleet', 'hr.leave', FLEET, null, 1),
  listed('w-fleet-hq', 'hr.leave', FLEET, HQ, 0),
  listed('w-other-type', 'spec.other', null, null, 7),
];

describe('the chain a draft replaces', () => {
  it('names a listed row by its id and version, the version a save sends back', () => {
    expect(basisOf(ROWS[0] as ApprovalWorkflowDto)).toEqual({ id: 'w-default', version: 4 });
  });

  it('takes the row listed at exactly the draft’s type and place', () => {
    expect(basisAt(ROWS, 'hr.leave', null, null)).toEqual({ id: 'w-default', version: 4 });
    expect(basisAt(ROWS, 'hr.leave', FLEET.id, null)).toEqual({ id: 'w-fleet', version: 1 });
    expect(basisAt(ROWS, 'hr.leave', FLEET.id, HQ.id)).toEqual({ id: 'w-fleet-hq', version: 0 });
    // Another type's company default is another row of the unique index.
    expect(basisAt(ROWS, 'spec.other', null, null)).toEqual({ id: 'w-other-type', version: 7 });
  });

  it('is null where nothing is listed, never the wider row that would answer a request there', () => {
    // A branch with no row of its own: the company default answers its requests, but a draft for
    // the branch writes a row of its own, and replaces none.
    expect(basisAt(ROWS, 'hr.leave', null, HQ.id)).toBeNull();
    expect(basisAt(ROWS, 'hr.leave', 'dc-security', HQ.id)).toBeNull();
    expect(basisAt(ROWS, 'spec.other', FLEET.id, null)).toBeNull();
    expect(basisAt([], 'hr.leave', null, null)).toBeNull();
  });
});

describe('the chain a draft names, however it reached its place', () => {
  /** A draft as Add opens it: the type's company default, with the list the screen showed. */
  const opening = () =>
    placed({ requestType: 'hr.leave', departmentCatalogId: null, branchId: null, listed: ROWS });

  it('opens a new draft naming the chain listed at its starting place, or null where none is', () => {
    const opened = opening();
    // Null would say the screen saw no chain there, and the server refuses null over a chain.
    expect(opened.basedOn).toEqual({ id: 'w-default', version: 4 });
    expect(placed({ ...opened, listed: [] }).basedOn).toBeNull();
  });

  it('names the same row and version at one place whether the draft opened there or was moved there and back', () => {
    const opened = opening();
    const away = placed({ ...opened, departmentCatalogId: FLEET.id });
    expect(away.basedOn).toEqual({ id: 'w-fleet', version: 1 });
    const nowhere = placed({ ...away, branchId: HQ.id, departmentCatalogId: 'dc-security' });
    expect(nowhere.basedOn).toBeNull();
    const back = placed({ ...nowhere, departmentCatalogId: null, branchId: null });
    expect(back.basedOn).toEqual(opened.basedOn);
    expect(placed({ ...back, requestType: 'spec.other' }).basedOn).toEqual({
      id: 'w-other-type',
      version: 7,
    });
  });

  it('reads the list the draft was opened with, not a newer one another administrator’s save produced', () => {
    // Another administrator saves the default (version 5) and writes a chain for HQ while this
    // draft is open; the list behind the dialog refetches. The draft, moved away and back, still
    // names version 4, so its save is refused as stale rather than overwriting theirs.
    const opened = opening();
    const newer = [
      listed('w-default', 'hr.leave', null, null, 5),
      listed('w-hq', 'hr.leave', null, HQ, 0),
      ...ROWS.slice(1),
    ];
    const back = placed({ ...placed({ ...opened, branchId: HQ.id }), branchId: null });
    expect(back.basedOn).toEqual({ id: 'w-default', version: 4 });
    expect(placed({ ...opened, branchId: HQ.id }).basedOn).toBeNull();
    // Opened on the newer list, a draft names what that list shows.
    expect(placed({ ...opened, listed: newer }).basedOn).toEqual({ id: 'w-default', version: 5 });
    expect(placed({ ...opened, listed: newer, branchId: HQ.id }).basedOn).toEqual({
      id: 'w-hq',
      version: 0,
    });
  });
});
