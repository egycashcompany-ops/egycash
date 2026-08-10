// The bulk selector must never be a way around a locked checkbox.
//
// Everything here turns on one rule: a bulk operation may only do what the administrator could do
// by clicking each box in turn. The failure it guards against is silent and serious — a "select
// all" that ticks a permission the actor is not allowed to grant produces a role the server
// refuses, and a "clear all" that unticks one they cannot re-add is a privilege they just destroyed
// and cannot restore.
import { describe, expect, it } from 'vitest';
import { type PermissionDto } from '@ecms/contracts';
import {
  applyBulk,
  bulkIntent,
  grantableKeys,
  groupState,
  matchesSearch,
  selectedCount,
  type MatrixRow,
} from './permission-selection';

const definition = (key: string, moduleId = 'hr'): PermissionDto => ({
  key,
  resource: key.split('.')[0] ?? key,
  action: key.split('.')[1] ?? 'view',
  moduleId,
  name: { ar: `صلاحية ${key}`, en: `Permission ${key}` },
  breakGlass: false,
});

const row = (key: string, moduleId = 'hr'): MatrixRow => ({ key, definition: definition(key, moduleId) });
/** A key the registry no longer declares — rendered, but never a bulk target. */
const orphan = (key: string): MatrixRow => ({ key, definition: undefined });

const HR = [row('employee.view'), row('employee.edit'), row('employee.delete')];
/** The actor holds everything except `employee.delete`. */
const held = (key: string): boolean => key !== 'employee.delete';
const all = (): boolean => true;

describe('grantableKeys — what a bulk control may reach', () => {
  it('is the intersection of "the registry knows it" and "the actor holds it"', () => {
    expect(grantableKeys(HR, held)).toEqual(['employee.view', 'employee.edit']);
  });

  it('never includes a key the registry has forgotten, even for an actor who holds everything', () => {
    expect(grantableKeys([...HR, orphan('retired.view')], all)).toEqual([
      'employee.view',
      'employee.edit',
      'employee.delete',
    ]);
  });
});

describe('groupState — what the checkbox shows', () => {
  it('is none, some and all as the selection fills up', () => {
    expect(groupState(HR, new Set())).toBe('none');
    expect(groupState(HR, new Set(['employee.view']))).toBe('some');
    expect(groupState(HR, new Set(HR.map((r) => r.key)))).toBe('all');
  });

  // The consequence of counting EVERY row rather than only the reachable ones, stated as a test so
  // nobody "fixes" it into a checkbox that claims a module is fully selected when it is not.
  it('stays `some` when the only unselected row is one the actor cannot grant', () => {
    expect(groupState(HR, new Set(['employee.view', 'employee.edit']))).toBe('some');
  });

  it('is none for an empty group rather than vacuously all', () => {
    expect(groupState([], new Set())).toBe('none');
  });
});

describe('applyBulk — selecting', () => {
  it('adds every grantable key and leaves the locked one alone', () => {
    expect(applyBulk([], HR, true, held)).toEqual(['employee.view', 'employee.edit']);
  });

  it('adds all three when the actor holds all three', () => {
    expect(applyBulk([], HR, true, all)).toEqual([
      'employee.view',
      'employee.edit',
      'employee.delete',
    ]);
  });

  it('keeps keys from other modules untouched, and adds no duplicates', () => {
    const current = ['fleet.vehicle.view', 'employee.view'];
    expect(applyBulk(current, HR, true, held)).toEqual([
      'fleet.vehicle.view',
      'employee.view',
      'employee.edit',
    ]);
  });

  it('never selects a key the registry has forgotten', () => {
    const result = applyBulk([], [...HR, orphan('retired.view')], true, all);
    expect(result).not.toContain('retired.view');
  });
});

describe('applyBulk — clearing', () => {
  it('removes the grantable keys only', () => {
    const current = ['employee.view', 'employee.edit', 'employee.delete'];
    // `employee.delete` survives: its own checkbox is locked, so this control may not remove it.
    expect(applyBulk(current, HR, false, held)).toEqual(['employee.delete']);
  });

  it('leaves other modules alone', () => {
    const current = ['fleet.vehicle.view', 'employee.view'];
    expect(applyBulk(current, HR, false, held)).toEqual(['fleet.vehicle.view']);
  });

  it('does not strip a forgotten key the role still carries', () => {
    const current = ['retired.view', 'employee.view'];
    const result = applyBulk(current, [...HR, orphan('retired.view')], false, all);
    expect(result).toEqual(['retired.view']);
  });
});

describe('bulkIntent — which way the press goes', () => {
  it('selects while anything reachable is still unselected', () => {
    expect(bulkIntent(HR, new Set(), held)).toBe(true);
    expect(bulkIntent(HR, new Set(['employee.view']), held)).toBe(true);
  });

  // The important one: with the locked key unselected the group reads `some`, but everything the
  // actor CAN reach is already ticked — so the next press must clear, not sit there doing nothing.
  it('clears once every reachable key is selected, even if the group still reads `some`', () => {
    const selection = new Set(['employee.view', 'employee.edit']);
    expect(groupState(HR, selection)).toBe('some');
    expect(bulkIntent(HR, selection, held)).toBe(false);
  });

  it('round-trips: select then clear returns to the starting point', () => {
    const start = ['employee.delete'];
    const selected = applyBulk(start, HR, bulkIntent(HR, new Set(start), held), held);
    expect(selected.sort()).toEqual(['employee.delete', 'employee.edit', 'employee.view']);
    const cleared = applyBulk(selected, HR, bulkIntent(HR, new Set(selected), held), held);
    expect(cleared).toEqual(['employee.delete']);
  });
});

describe('matchesSearch — a display filter and nothing more', () => {
  it('matches the key, and either language of the name', () => {
    expect(matchesSearch(row('employee.view'), 'employee')).toBe(true);
    expect(matchesSearch(row('employee.view'), 'Permission employee.view')).toBe(true);
    expect(matchesSearch(row('employee.view'), 'صلاحية')).toBe(true);
    expect(matchesSearch(row('employee.view'), 'fleet')).toBe(false);
  });

  it('is case-insensitive and ignores surrounding space', () => {
    expect(matchesSearch(row('employee.view'), '  EMPLOYEE  ')).toBe(true);
  });

  it('matches everything when the term is empty', () => {
    expect(matchesSearch(orphan('retired.view'), '')).toBe(true);
  });

  it('can still match a key the registry has forgotten', () => {
    expect(matchesSearch(orphan('retired.view'), 'retired')).toBe(true);
  });
});

describe('selectedCount', () => {
  it('counts only rows in the group', () => {
    expect(selectedCount(HR, new Set(['employee.view', 'fleet.vehicle.view']))).toBe(1);
  });
});
