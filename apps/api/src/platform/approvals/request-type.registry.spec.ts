// The request-type registry, and the one thing it is for.
//
// A registry is only worth having if it actually keeps the platform from knowing what a leave
// request is. These pin that: the platform ships no request type of its own, a module's own
// declaration is what puts one there, and the configuration screen can only offer keys the module
// named — because a chain built around a key nothing declares resolves to «nobody holds this»:
// nobody decides its rung as their own, so it is passed when a staffed rung above it is decided,
// and with no staffed rung above it a request that reaches it waits `unstaffed` until an override
// within reach decides it, on a chain that looks configured.
//
// The audit option (R5, PX-1.5 of docs/12-planning/administration-module-phase-px1.md §6.6) is kept
// beside each type, never on the DTO the screen is sent.
import { afterEach, describe, expect, it } from 'vitest';
import {
  auditModeOf,
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
// Copied before any case registers the original. The registry keeps the caller's object, so a case
// comparing the stored type with that same object would compare it with itself, and a copy taken
// inside a later case would copy whatever an earlier case had written onto it.
const regularizationAsDeclared = structuredClone(regularization);

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

describe('who audits a decision of each type (R5)', () => {
  it('answers the option a type registered with, and engine for one registered without it', () => {
    // Leave registers without it, so the engine keeps writing leave's row (exit criterion 5).
    registerApprovalRequestType(leave);
    registerApprovalRequestType(regularization, { audit: 'host' });
    expect(auditModeOf('hr.leave')).toBe('engine');
    expect(auditModeOf('hr.regularization')).toBe('host');

    registerApprovalRequestType({ ...leave, key: 'hr.explicit' }, { audit: 'engine' });
    expect(auditModeOf('hr.explicit')).toBe('engine');
  });

  it('keeps the option beside the type: the getter and the list hand back the declaration alone', () => {
    // The list is what the configuration screen is sent, and who writes the audit row is not the
    // administrator's to see.
    registerApprovalRequestType(regularization, { audit: 'host' });
    expect(auditModeOf('hr.regularization')).toBe('host');
    expect(getApprovalRequestType('hr.regularization')).toStrictEqual(regularizationAsDeclared);
    expect(getApprovalRequestType('hr.regularization')).not.toHaveProperty('audit');
    expect(listApprovalRequestTypes()).toStrictEqual([regularizationAsDeclared]);
  });

  it('replaces the option when a type re-registers, back to engine when the option is left out', () => {
    registerApprovalRequestType(regularization);
    registerApprovalRequestType(regularization, { audit: 'host' });
    expect(auditModeOf('hr.regularization')).toBe('host');
    registerApprovalRequestType(regularization);
    expect(auditModeOf('hr.regularization')).toBe('engine');
  });

  it('clears the option with the types, so a type nobody registered reads engine', () => {
    registerApprovalRequestType(regularization, { audit: 'host' });
    expect(auditModeOf('hr.regularization')).toBe('host');
    clearApprovalRequestTypes();
    expect(listApprovalRequestTypes()).toEqual([]);
    expect(auditModeOf('hr.regularization')).toBe('engine');
  });
});
