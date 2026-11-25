// What a draft on the approval-chain screen names as the chain it replaces (R9, PX-1.6 of
// docs/12-planning/administration-module-phase-px1.md §6.7). A save is refused as stale unless it
// names the place's row as the screen listed it, by id and version, or null where it listed none.
import { describe, expect, it } from 'vitest';
import { type ApprovalWorkflowDto } from '@ecms/contracts';
import { basisAt, basisOf } from './chain-basis';

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
