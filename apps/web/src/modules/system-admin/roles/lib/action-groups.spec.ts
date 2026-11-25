import { describe, expect, it } from 'vitest';
import { type PermissionDto } from '@ecms/contracts';
import { ACTION_GROUPS, actionGroupOf, rowsOfGroup } from './action-groups';
import { applyBulk, bulkIntent, groupState, type MatrixRow } from './permission-selection';

const permission = (
  key: string,
  moduleId: string,
  { breakGlass = false, action }: { breakGlass?: boolean; action?: string } = {},
): PermissionDto => ({
  key,
  resource: key.split('.')[0] ?? key,
  action: action ?? key.split('.')[1] ?? 'view',
  moduleId,
  name: { ar: key, en: key },
  breakGlass,
  pageId: null,
});

const row = (p: PermissionDto): MatrixRow => ({ key: p.key, definition: p });

describe('a permission belongs to the type its registry action names', () => {
  it.each([
    ['view', 'view'],
    ['viewLog', 'view'],
    ['viewLedger', 'view'],
    ['create', 'create'],
    ['record', 'create'],
    ['upload', 'create'],
    ['edit', 'edit'],
    ['changeCode', 'edit'],
    ['locate', 'edit'],
    ['delete', 'delete'],
    ['export', 'export'],
    ['print', 'export'],
    ['download', 'export'],
    ['import', 'import'],
    ['importRoster', 'import'],
    ['approve', 'approve'],
    ['decide', 'approve'],
    ['confirm', 'approve'],
    ['manage', 'manage'],
    ['configure', 'manage'],
    ['assign', 'manage'],
  ])('%s → %s', (action, group) => {
    expect(actionGroupOf({ action, breakGlass: false })).toBe(group);
  });

  it('keeps every sensitive read OUT of View — «قراءة فقط» never hands out a secret', () => {
    for (const action of [
      'viewSensitive',
      'viewCompensation',
      'viewInsurance',
      'viewOfficer',
      'viewNationalId',
      'viewSecrets',
      'reveal',
    ]) {
      expect(actionGroupOf({ action, breakGlass: false })).toBe('sensitive');
    }
  });

  it('puts a break-glass key in its own type whatever its action', () => {
    expect(actionGroupOf({ action: 'purge', breakGlass: true })).toBe('breakGlass');
    expect(actionGroupOf({ action: 'manageSessions', breakGlass: true })).toBe('breakGlass');
    // Even an action that would otherwise be the most ordinary of all.
    expect(actionGroupOf({ action: 'view', breakGlass: true })).toBe('breakGlass');
  });

  it('sends an action it does not name to Workflow actions, never into a broader type', () => {
    for (const action of ['complete', 'close', 'dispatch', 'somethingNew']) {
      expect(actionGroupOf({ action, breakGlass: false })).toBe('other');
    }
  });

  it('lists every type exactly once, the everyday ones first and the guarded ones last', () => {
    expect(new Set(ACTION_GROUPS).size).toBe(ACTION_GROUPS.length);
    expect(ACTION_GROUPS.slice(0, 4)).toEqual(['view', 'create', 'edit', 'delete']);
    expect(ACTION_GROUPS.slice(-2)).toEqual(['sensitive', 'breakGlass']);
  });
});

describe('a type over a scope', () => {
  const rows = [
    row(permission('atmMachine.view', 'atm')),
    row(permission('atmMachine.edit', 'atm')),
    row(permission('atmRegister.viewSecrets', 'atm')),
    row(permission('employee.view', 'hr')),
    row(permission('employee.purge', 'hr', { breakGlass: true })),
    // A key the registry no longer knows: no action, so no type.
    { key: 'retired.view', definition: undefined },
  ];

  it('takes every module, or only the chosen one', () => {
    expect(rowsOfGroup(rows, 'view', null).map((r) => r.key)).toEqual([
      'atmMachine.view',
      'employee.view',
    ]);
    expect(rowsOfGroup(rows, 'view', 'atm').map((r) => r.key)).toEqual(['atmMachine.view']);
  });

  it('never counts an unknown key, even one whose spelling ends in .view', () => {
    expect(rowsOfGroup(rows, 'view', null).map((r) => r.key)).not.toContain('retired.view');
    expect(rowsOfGroup(rows, 'other', null).map((r) => r.key)).not.toContain('retired.view');
  });

  it('read only over ATM ticks the plain reads and nothing secret or break-glass', () => {
    const view = rowsOfGroup(rows, 'view', 'atm');
    const everything = (): boolean => true;
    const next = applyBulk([], view, bulkIntent(view, new Set(), everything), everything);
    expect(next).toEqual(['atmMachine.view']);
  });

  it('goes through the matrix’s own rule: a key the editor may not grant is neither added nor cleared', () => {
    const view = rowsOfGroup(rows, 'view', null);
    const holdsOnlyAtm = (key: string): boolean => key.startsWith('atm');
    // Adding: only the held key arrives.
    expect(applyBulk([], view, true, holdsOnlyAtm)).toEqual(['atmMachine.view']);
    // Clearing: the carried, unheld `employee.view` survives the sweep.
    const carried = ['atmMachine.view', 'employee.view'];
    expect(groupState(view, new Set(carried))).toBe('all');
    expect(bulkIntent(view, new Set(carried), holdsOnlyAtm)).toBe(false);
    expect(applyBulk(carried, view, false, holdsOnlyAtm)).toEqual(['employee.view']);
  });
});
