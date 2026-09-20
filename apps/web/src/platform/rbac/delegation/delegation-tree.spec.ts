// The tree the «الصلاحيات» screen is walked down, checked directly.
//
// Every number this module produces is drawn on the screen next to the rows it counts, so a count
// that drifts from the rows is not a cosmetic bug — it is the screen telling the manager he granted
// something other than what he granted. And the one rule the level checkboxes could quietly break
// is the same one the server enforces: a clear at branch level must not remove a key the caller was
// never entitled to remove.
import { describe, expect, it } from 'vitest';
import { type DelegationCatalogDto, type DelegationDto, type PermissionDto } from '@ecms/contracts';
import {
  buildTree,
  ceilingOf,
  clearBranch,
  grantLines,
  parseUnit,
  setAll,
  unitKey,
  withSavedUnits,
  type BranchNode,
} from './delegation-tree';

const p = (key: string, moduleId: string, pageId: string | null): PermissionDto => ({
  key,
  resource: key.split('.')[0] ?? key,
  action: key.split('.')[1] ?? '',
  moduleId,
  name: { ar: key, en: key },
  breakGlass: false,
  pageId,
});

const CATALOG: DelegationCatalogDto = {
  branches: [
    {
      id: 'A',
      name: { ar: 'المهندسين', en: 'Mohandessin' },
      // A whole-branch holder: every department under A inherits these and adds nothing.
      permissionKeys: ['employee.view', 'employee.edit'],
      departments: [
        { id: 'd1', name: { ar: 'الحركة', en: 'Fleet' }, permissionKeys: [] },
        { id: 'd2', name: { ar: 'الأمن', en: 'Security' }, permissionKeys: [] },
      ],
    },
    {
      id: 'B',
      name: { ar: 'أكتوبر', en: 'October' },
      // A department-level holder: nothing over the branch, keys in one department only.
      permissionKeys: [],
      departments: [
        {
          id: 'd3',
          name: { ar: 'الحركة', en: 'Fleet' },
          permissionKeys: ['vehicle.view', 'vehicle.edit', 'setting.manage'],
        },
      ],
    },
  ],
  pages: [
    { id: 'hr.employees', moduleId: 'hr', name: { ar: 'الموظفين', en: 'Employees' }, route: null, sortOrder: 1 },
    { id: 'fleet.vehicles', moduleId: 'fleet', name: { ar: 'السيارات', en: 'Vehicles' }, route: null, sortOrder: 2 },
  ],
  permissions: [
    p('employee.view', 'hr', 'hr.employees'),
    p('employee.edit', 'hr', 'hr.employees'),
    p('vehicle.view', 'fleet', 'fleet.vehicles'),
    p('vehicle.edit', 'fleet', 'fleet.vehicles'),
    p('setting.manage', 'platform', null),
  ],
};

const NOTHING = new Set<string>();
const tree = (
  selected: Record<string, string[]> = {},
  saved: Record<string, string[]> = {},
  cat: DelegationCatalogDto = CATALOG,
): BranchNode[] =>
  buildTree(
    cat,
    (unit) => new Set(selected[unitKey(unit)] ?? saved[unitKey(unit)] ?? []),
    (unit) => new Set(saved[unitKey(unit)] ?? []),
  );

const branchOf = (nodes: BranchNode[], id: string): BranchNode => {
  const found = nodes.find((b) => b.id === id);
  if (found === undefined) throw new Error(`branch ${id} missing from the tree`);
  return found;
};

describe('the unit key', () => {
  it('round-trips a department and a whole branch', () => {
    expect(parseUnit(unitKey({ branchId: 'A', departmentId: 'd1' }))).toEqual({ branchId: 'A', departmentId: 'd1' });
    expect(parseUnit(unitKey({ branchId: 'A', departmentId: null }))).toEqual({ branchId: 'A', departmentId: null });
  });
});

describe('the ceiling of a unit', () => {
  it('gives a department the branch keys plus its own', () => {
    expect([...ceilingOf(CATALOG, { branchId: 'B', departmentId: 'd3' })].sort()).toEqual([
      'setting.manage',
      'vehicle.edit',
      'vehicle.view',
    ]);
    expect([...ceilingOf(CATALOG, { branchId: 'A', departmentId: 'd1' })].sort()).toEqual([
      'employee.edit',
      'employee.view',
    ]);
  });

  it('gives nothing over a branch the caller only holds a department in', () => {
    expect(ceilingOf(CATALOG, { branchId: 'B', departmentId: null }).size).toBe(0);
  });

  it('gives nothing in a department the catalog does not offer under that branch', () => {
    expect(ceilingOf(CATALOG, { branchId: 'A', departmentId: 'd3' }).size).toBe(0);
  });
});

describe('the shape of the tree', () => {
  const nodes = tree();

  it('hangs the whole-branch record and the departments off each branch', () => {
    expect(nodes.map((b) => b.id)).toEqual(['A', 'B']);
    expect(branchOf(nodes, 'A').departments.map((d) => d.id)).toEqual(['d1', 'd2']);
    expect(branchOf(nodes, 'A').whole.unit).toEqual({ branchId: 'A', departmentId: null });
  });

  it('groups a unit’s screens the way the registry does, with the no-page bucket last', () => {
    const d3 = branchOf(nodes, 'B').departments[0];
    expect(d3?.modules.map((m) => m.moduleId)).toEqual(['fleet', null]);
    expect(d3?.modules[0]?.screens.map((s) => s.id)).toEqual(['fleet.vehicles']);
    expect(d3?.modules[1]?.screens.map((s) => s.id)).toEqual(['other']);
  });

  it('marks a block the caller may not grant in as not editable', () => {
    expect(branchOf(nodes, 'B').whole.editable).toBe(false);
    expect(branchOf(nodes, 'A').whole.editable).toBe(true);
  });

  it('starts with nothing ticked anywhere', () => {
    expect(nodes.every((b) => b.state === 'none')).toBe(true);
    expect(branchOf(nodes, 'A').departmentsOn).toBe(0);
  });
});

describe('the counts drawn beside the rows', () => {
  it('counts ticked actions and screens against everything shown', () => {
    const d3 = branchOf(tree({ 'B:d3': ['vehicle.view'] }), 'B').departments[0];
    expect(d3?.actionsOn).toBe(1);
    expect(d3?.actionsTotal).toBe(3);
    expect(d3?.screensOn).toBe(1);
    expect(d3?.screensTotal).toBe(2);
    expect(d3?.state).toBe('some');
    expect(d3?.viewOnly).toBe(true);
    expect(d3?.everything).toBe(false);
  });

  it('reads «everything» only when every action shown is on', () => {
    const d3 = branchOf(tree({ 'B:d3': ['vehicle.view', 'vehicle.edit', 'setting.manage'] }), 'B').departments[0];
    expect(d3?.everything).toBe(true);
    expect(d3?.state).toBe('all');
    expect(d3?.viewOnly).toBe(false);
  });

  it('counts a screen nothing on it is the caller’s to grant, and still shows what was granted there', () => {
    // `vehicle.*` is out of reach in A, but somebody with more authority granted it on d1.
    const d1 = branchOf(tree({}, { 'A:d1': ['vehicle.view'] }), 'A').departments[0];
    expect(d1?.lockedScreens).toBe(1);
    expect(d1?.screensTotal).toBe(2);
    expect(d1?.actionsOn).toBe(1);
    expect(d1?.modules.flatMap((m) => m.screens).find((s) => s.id === 'fleet.vehicles')?.grantable).toBe(false);
  });

  it('counts the screens still to tick without counting the locked ones as ticked', () => {
    // `vehicle.*` is out of reach in A. A wider grant put a key on the department, so ONE screen is
    // on — the locked one — while the caller's own screen is still untouched. Subtracting the two
    // counts from the total would have said «nothing left to tick», which is the opposite.
    const d1 = branchOf(tree({}, { 'A:d1': ['vehicle.view'] }), 'A').departments[0];
    expect(d1?.screensOn).toBe(1);
    expect(d1?.lockedScreens).toBe(1);
    expect(d1?.untickedScreens).toBe(1);
  });

  it('rolls a branch up from its own record and its departments', () => {
    const half = branchOf(tree({ 'A:d1': ['employee.view'] }), 'A');
    expect(half.state).toBe('some');
    expect(half.departmentsOn).toBe(1);
    expect(half.departmentsTotal).toBe(2);

    const whole = branchOf(tree({ 'A:*': ['employee.view', 'employee.edit'] }), 'A');
    expect(whole.state).toBe('all');
    expect(whole.whole.everything).toBe(true);
  });
});

describe('the whole-branch grant', () => {
  it('carries the departments beneath it rather than ticking them', () => {
    const branch = branchOf(tree({ 'A:*': ['employee.view', 'employee.edit'] }), 'A');
    expect(branch.departments.every((d) => d.coveredByBranch)).toBe(true);
    // Carried, not copied: nothing was written into the departments' own records.
    expect(branch.departments.every((d) => d.actionsOn === 0)).toBe(true);
  });

  it('stops carrying them the moment it is cleared', () => {
    expect(branchOf(tree(), 'A').departments.every((d) => d.coveredByBranch)).toBe(false);
  });

  it('carries nothing it does not actually hold — a partial branch grant locks no department', () => {
    // The branch record holds one of the two keys a department could be given here, so the other
    // is still the caller's to grant and the department must stay open.
    const branch = branchOf(tree({ 'A:*': ['employee.view'] }), 'A');
    expect(branch.departments.every((d) => d.coveredByBranch)).toBe(false);
  });

  it('does not lock a department-level manager out of his own department', () => {
    // Branch B: the caller holds nothing over the branch and everything in d3. Somebody above him
    // granted the target a whole-branch record there. Reading «the branch record has keys» as
    // «the departments are carried» would hide d3 — the one unit he actually delegates in.
    const b = branchOf(tree({}, { 'B:*': ['employee.view'] }), 'B');
    expect(b.whole.editable).toBe(false);
    expect(b.whole.actionsOn).toBe(1);
    expect(b.departments[0]?.editable).toBe(true);
    expect(b.departments[0]?.coveredByBranch).toBe(false);
  });

  it('does not hide a department that holds something of its own', () => {
    const branch = branchOf(
      tree({ 'A:*': ['employee.view', 'employee.edit'] }, { 'A:d1': ['employee.view'] }),
      'A',
    );
    expect(branch.departments[0]?.coveredByBranch).toBe(false);
    expect(branch.departments[1]?.coveredByBranch).toBe(true);
  });
});

describe('the open/closed default of a module group', () => {
  it('reads the saved record, not the draft, so it holds still while the manager ticks', () => {
    const saved = { 'B:d3': ['vehicle.view'] };
    const withSaved = branchOf(tree({}, saved), 'B').departments[0];
    expect(withSaved?.modules[0]?.savedOn).toBe(1);

    // He clears the last tick. `on` drops to zero; `savedOn` — which the default reads — does not,
    // so the group he is working in does not shut under his hand.
    const cleared = branchOf(tree({ 'B:d3': [] }, saved), 'B').departments[0];
    expect(cleared?.modules[0]?.on).toBe(0);
    expect(cleared?.modules[0]?.savedOn).toBe(1);
  });

  it('is closed for a group nothing was ever saved in', () => {
    const fresh = branchOf(tree({ 'B:d3': ['vehicle.view'] }), 'B').departments[0];
    expect(fresh?.modules[0]?.on).toBe(1);
    expect(fresh?.modules[0]?.savedOn).toBe(0);
  });
});

describe('ticking a whole unit', () => {
  it('adds every key the caller may grant there', () => {
    const ceiling = ceilingOf(CATALOG, { branchId: 'B', departmentId: 'd3' });
    expect([...setAll(NOTHING, ceiling, true)].sort()).toEqual(['setting.manage', 'vehicle.edit', 'vehicle.view']);
  });

  it('never moves a key outside the ceiling, in either direction', () => {
    const ceiling = ceilingOf(CATALOG, { branchId: 'A', departmentId: 'd1' });
    const held = new Set(['employee.view', 'vehicle.view']);
    expect([...setAll(held, ceiling, false)]).toEqual(['vehicle.view']);
    expect([...setAll(held, ceiling, true)].sort()).toEqual(['employee.edit', 'employee.view', 'vehicle.view']);
  });
});

describe('clearing a branch', () => {
  it('empties every unit under it', () => {
    const branch = branchOf(tree({ 'A:*': ['employee.view'], 'A:d1': ['employee.edit'] }), 'A');
    expect(clearBranch(branch)).toEqual({ 'A:*': [], 'A:d1': [], 'A:d2': [] });
  });

  it('leaves behind exactly what the caller could not have removed', () => {
    // Granted on d1 by somebody who reaches further than the caller: a clear is not a revoke.
    const branch = branchOf(tree({}, { 'A:d1': ['employee.view', 'vehicle.view'] }), 'A');
    expect(clearBranch(branch)['A:d1']).toEqual(['vehicle.view']);
  });
});

describe('units the caller cannot reach', () => {
  const grant = (branchId: string, departmentId: string | null): DelegationDto => ({
    id: `g-${branchId}-${departmentId ?? 'all'}`,
    userId: 'u1',
    branch: { id: branchId, name: { ar: 'طنطا', en: 'Tanta' } },
    department: departmentId === null ? null : { id: departmentId, name: { ar: 'المالية', en: 'Finance' } },
    permissionKeys: ['employee.view'],
    grantedBy: null,
    updatedAt: '2026-09-20T00:00:00.000Z',
  });

  it('folds a branch known only from an existing grant into the tree, with nothing grantable', () => {
    const merged = withSavedUnits(CATALOG, [grant('C', 'd9')], null);
    const nodes = tree({}, { 'C:d9': ['employee.view'] }, merged);
    const c = branchOf(nodes, 'C');
    expect(c.name.ar).toBe('طنطا');
    expect(c.whole.editable).toBe(false);
    expect(c.departments[0]?.editable).toBe(false);
    // Visible and counted — a grant that disappears reads as a grant that was removed.
    expect(c.departments[0]?.actionsOn).toBe(1);
  });

  it('pins the account’s own placement even when nothing was ever granted there', () => {
    const merged = withSavedUnits(CATALOG, [], {
      branchId: 'D',
      departmentId: 'd8',
      branchName: { ar: 'المعادي', en: 'Maadi' },
      departmentName: { ar: 'العمليات', en: 'Operations' },
    });
    const d = branchOf(tree({}, {}, merged), 'D');
    expect(d.name.en).toBe('Maadi');
    expect(d.departments.map((x) => x.name.en)).toEqual(['Operations']);
  });

  it('puts the account’s own branch and department first', () => {
    const merged = withSavedUnits(CATALOG, [], { branchId: 'B', departmentId: 'd3' });
    expect(merged.branches.map((b) => b.id)).toEqual(['B', 'A']);
    const both = withSavedUnits(CATALOG, [], { branchId: 'A', departmentId: 'd2' });
    expect(both.branches[0]?.departments.map((d) => d.id)).toEqual(['d2', 'd1']);
  });

  it('does not duplicate a unit the catalog already offers', () => {
    const merged = withSavedUnits(CATALOG, [grant('A', 'd1')], { branchId: 'A', departmentId: 'd1' });
    expect(merged.branches.filter((b) => b.id === 'A')).toHaveLength(1);
    expect(branchOf(tree({}, {}, merged), 'A').departments.map((d) => d.id)).toEqual(['d1', 'd2']);
  });
});

describe('the summary line', () => {
  it('names one line per unit that ends up with something on it', () => {
    const lines = grantLines(tree({ 'B:d3': ['vehicle.view'], 'A:d1': ['employee.view', 'employee.edit'] }));
    expect(lines.map((l) => [l.branch.en, l.department?.en, l.screens, l.actions])).toEqual([
      ['Mohandessin', 'Fleet', 1, 2],
      ['October', 'Fleet', 1, 1],
    ]);
    expect(lines[0]?.everything).toBe(true);
    expect(lines[1]?.viewOnly).toBe(true);
  });

  it('collapses a branch grant to one line and drops the departments it carries', () => {
    const lines = grantLines(tree({ 'A:*': ['employee.view'], 'A:d1': ['employee.edit'] }));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.department).toBeNull();
    expect(lines[0]?.branch.en).toBe('Mohandessin');
  });

  it('says nothing when nothing is ticked', () => {
    expect(grantLines(tree())).toEqual([]);
  });
});
