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
  acceptsToggle,
  applyBulk,
  bulkIntent,
  grantableKeys,
  groupState,
  matchesSearch,
  rowEditability,
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
  pageId: null,
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

// ── A key the registry has forgotten ────────────────────────────────────────
//
// The role carries it because a retired module once declared it. Both obvious treatments are wrong:
// locking it leaves an administrator unable to clean it up, and treating it as ordinary would let it
// be handed back out — an authority nothing in the system defines any more. It comes off, and never
// back on. The previous implementation chose the first of those by disabling the row outright.

describe('rowEditability — an unknown key comes OFF, never back ON', () => {
  const editableFor = (row: MatrixRow, isHeld: boolean): ReturnType<typeof rowEditability> =>
    rowEditability(row, { held: isHeld, readOnly: false });

  it('leaves an unknown key removable — its checkbox is not locked', () => {
    expect(editableFor(orphan('retired.view'), false)).toBe('removeOnly');
    expect(acceptsToggle('removeOnly', false)).toBe(true);
  });

  it('refuses to add an unknown key back', () => {
    expect(acceptsToggle('removeOnly', true)).toBe(false);
  });

  // The actor never "holds" a key nothing declares, so holding must not be what decides this.
  it('does not depend on the actor holding it, which they cannot', () => {
    expect(editableFor(orphan('retired.view'), true)).toBe('removeOnly');
  });

  it('keeps a permission the actor does not hold locked in BOTH directions', () => {
    expect(editableFor(row('employee.delete'), false)).toBe('locked');
    expect(acceptsToggle('locked', true)).toBe(false);
    expect(acceptsToggle('locked', false)).toBe(false);
  });

  it('leaves an ordinary held permission fully editable', () => {
    expect(editableFor(row('employee.view'), true)).toBe('editable');
    expect(acceptsToggle('editable', true)).toBe(true);
    expect(acceptsToggle('editable', false)).toBe(true);
  });

  it('locks everything when the role is read-only, unknown keys included', () => {
    for (const r of [row('employee.view'), orphan('retired.view')]) {
      expect(rowEditability(r, { held: true, readOnly: true })).toBe('locked');
    }
  });
});

describe('bulk selection leaves unknown keys exactly where they were', () => {
  const ROWS = [...HR, orphan('retired.view')];
  const SELECTED = ['employee.view', 'retired.view'];

  it('does not ADD one when selecting everything', () => {
    const next = applyBulk([], ROWS, true, all);
    expect(next).not.toContain('retired.view');
    expect(next).toEqual(['employee.view', 'employee.edit', 'employee.delete']);
  });

  it('does not REMOVE one when clearing everything', () => {
    expect(applyBulk(SELECTED, ROWS, false, all)).toEqual(['retired.view']);
  });

  // The round trip is what an administrator actually does: clear the module, change their mind,
  // select it again. The unknown key must be in the same state at the end as at the start.
  it('survives a clear-then-select round trip untouched', () => {
    const cleared = applyBulk(SELECTED, ROWS, false, held);
    const restored = applyBulk(cleared, ROWS, true, held);
    expect(restored).toContain('retired.view');
    expect(restored.filter((key) => key === 'retired.view')).toHaveLength(1);
  });

  // An unknown key is always selected — it is only rendered because the role carries it — so it can
  // never be the reason a bulk press reads as "there is still something to add".
  it('is never what makes a module look incomplete', () => {
    expect(bulkIntent(ROWS, new Set(['employee.view', 'employee.edit', 'employee.delete']), all)).toBe(
      false,
    );
  });
});
