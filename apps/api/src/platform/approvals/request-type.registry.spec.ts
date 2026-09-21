// The request-type registry, and the one thing it is for.
//
// A registry is only worth having if it actually keeps the platform from knowing what a leave
// request is. These pin that: the platform ships no request type of its own, a module's own
// declaration is what puts one there, and the configuration screen can only offer keys the module
// named — because a chain built around a key nothing declares resolves to «nobody holds this», is
// SKIPPED, and approves everything while looking configured.
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearApprovalRequestTypes,
  getApprovalRequestType,
  listApprovalRequestTypes,
  registerApprovalRequestType,
} from './request-type.registry';

const leave = {
  key: 'hr.leave',
  moduleId: 'hr',
  name: { ar: 'طلبات الإجازة', en: 'Leave requests' },
  permissionKeys: ['leave.approve'],
};
const regularization = {
  key: 'hr.regularization',
  moduleId: 'hr',
  name: { ar: 'تسويات الحضور', en: 'Attendance regularizations' },
  permissionKeys: ['attendanceRegularization.approve'],
};

afterEach(() => clearApprovalRequestTypes());

describe('what the platform knows about request types', () => {
  it('knows nothing until a module says so', () => {
    expect(listApprovalRequestTypes()).toEqual([]);
    expect(getApprovalRequestType('hr.leave')).toBeNull();
  });

  it('takes a module’s declaration and hands it back whole', () => {
    registerApprovalRequestType(leave);
    expect(getApprovalRequestType('hr.leave')).toEqual(leave);
  });

  it('lists them in a stable order, so two deployments read the same', () => {
    registerApprovalRequestType(regularization);
    registerApprovalRequestType(leave);
    expect(listApprovalRequestTypes().map((type) => type.key)).toEqual([
      'hr.leave',
      'hr.regularization',
    ]);
  });

  it('replaces rather than duplicates when a module re-registers', () => {
    // Module files are imported once, but a test seam and a hot reload are both re-entries, and a
    // duplicated type would show the administrator the same request kind twice.
    registerApprovalRequestType(leave);
    registerApprovalRequestType({ ...leave, permissionKeys: ['leave.approve', 'leave.edit'] });
    expect(listApprovalRequestTypes()).toHaveLength(1);
    expect(getApprovalRequestType('hr.leave')?.permissionKeys).toEqual([
      'leave.approve',
      'leave.edit',
    ]);
  });

  it('carries the keys a chain may be built from, which is the point of the registry', () => {
    registerApprovalRequestType(leave);
    expect(getApprovalRequestType('hr.leave')?.permissionKeys).toEqual(['leave.approve']);
  });
});
