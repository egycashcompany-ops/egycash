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
  clearableIn,
  grantLines,
  parseUnit,
  setAll,
  unitKey,
  withSavedUnits,
  type BranchNode,
  type MergedCatalog,
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
  merged: MergedCatalog = { catalog: CATALOG, readOnly: new Set() },
): BranchNode[] =>
  buildTree(
    merged.catalog,
    (unit) => new Set(selected[unitKey(unit)] ?? saved[unitKey(unit)] ?? []),
    (unit) => new Set(saved[unitKey(unit)] ?? []),
    merged.readOnly,
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

  it('always opens the first group the caller can actually act in', () => {
    // A/d1: `vehicle.*` is out of the caller's reach there, and somebody above him granted one.
    // Opening only «a group with something ticked» would have opened the locked one and left the
    // grantable one shut — the manager landing on nothing he can do.
    const d1 = branchOf(tree({}, { 'A:d1': ['vehicle.view'] }), 'A').departments[0];
    const byModule = new Map(d1?.modules.map((m) => [m.moduleId, m]));
    expect(byModule.get('hr')?.grantableScreens).toBe(1);
    expect(byModule.get('hr')?.openByDefault).toBe(true);
    // The locked group opens too, and on purpose: it is what the account already holds, and a
    // grant nobody can see is a grant nobody can ask about.
    expect(byModule.get('fleet')?.grantableScreens).toBe(0);
    expect(byModule.get('fleet')?.savedOn).toBe(1);
    expect(byModule.get('fleet')?.openByDefault).toBe(true);
  });

  it('leaves a further group shut when it holds nothing — that is what the level is for', () => {
    const d3 = branchOf(tree(), 'B').departments[0];
    expect(d3?.modules.map((m) => m.openByDefault)).toEqual([true, false]);
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

describe('what the branch-level clear may take', () => {
  it('counts only the keys the caller could remove himself', () => {
    const branch = branchOf(tree({ 'A:*': ['employee.view'], 'A:d1': ['employee.edit'] }), 'A');
    expect(clearableIn(branch)).toBe(2);
  });

  it('counts nothing when the only grant there came from higher up', () => {
    // Branch B: the caller holds nothing over the branch, so a whole-branch grant somebody above
    // him made is not his to take away — and the control that would take it must not be offered.
    const b = branchOf(tree({}, { 'B:*': ['employee.view'] }), 'B');
    expect(b.whole.actionsOn).toBe(1);
    expect(clearableIn(b)).toBe(0);
  });

  it('counts nothing in a branch with nothing on it', () => {
    expect(clearableIn(branchOf(tree(), 'A'))).toBe(0);
  });
});

// ── «ادام حاجة مليش عليها اكسس مشوفهاش اصلا» ─────────────────────────────────
//
// The owner's rule, stated twice and in the strongest terms he used all session: «انا مش عايز
// الادارات مقفوله… ما يقوليش انت مش مسموح لك… ولا لونه رمادي… ما تظهرش اصلا». His own example is
// the shape of this block — «عندي مثلا فرع اكتوبر في اربع شاشات، يظهر اربع شاشات؛ ما يظهرليش بقى
// بقيه الشاشات ويقول لي اصل مش مسموح لك».
//
// It is pinned HERE, on the tree, rather than only on the panel, because a greyed row can come
// back two ways: by the panel drawing one again, and by the tree handing it one to draw. The
// second is the one that would slip through a render test that only checks what is on the screen.

describe('what the caller cannot reach is not in the tree at all', () => {
  it('gives a department only the screens its own ceiling covers', () => {
    // B·d3 holds vehicle.* and setting.manage — the Vehicles screen and the no-page bucket. The
    // Employees screen belongs to a module this caller cannot grant here, and is absent.
    const d3 = branchOf(tree(), 'B').departments[0];
    expect(d3?.screensTotal).toBe(2);
    const names = d3?.modules.flatMap((m) => m.screens.map((sc) => sc.page?.name.en ?? 'other'));
    expect(names).toEqual(['Vehicles', 'other']);
    expect(names).not.toContain('Employees');
  });

  it('gives a different department a different number of screens, in the same tree', () => {
    // A·d1 inherits the branch's employee.* and nothing else: one screen, where B·d3 had two.
    // Two departments, two counts, and neither padded out to the size of the registry.
    const d1 = branchOf(tree(), 'A').departments[0];
    expect(d1?.screensTotal).toBe(1);
    expect(d1?.modules.flatMap((m) => m.screens.map((sc) => sc.page?.name.en))).toEqual([
      'Employees',
    ]);
  });

  it('draws not one row the caller may not act on', () => {
    for (const branch of tree()) {
      for (const unit of [branch.whole, ...branch.departments]) {
        for (const screen of unit.modules.flatMap((m) => m.screens)) {
          // Everything drawn is either his to grant, or something the account already holds.
          expect(screen.grantable || screen.on > 0 || screen.savedOn > 0).toBe(true);
        }
      }
    }
  });

  it('leaves no unit reporting rows it does not draw', () => {
    // The counts beside a row are the only thing making a filtered list legible rather than
    // puzzling, so they count the VISIBLE screens — a total that included the hidden ones would
    // read «1 of 70» and send the manager looking for sixty-nine rows that are not there.
    const d3 = branchOf(tree(), 'B').departments[0];
    const drawn = d3?.modules.flatMap((m) => m.screens).length;
    expect(drawn).toBe(d3?.screensTotal);
    expect(d3?.actionsTotal).toBe(3);
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

  it('leaves the account’s own placement OUT when there is nothing there for this caller', () => {
    // «طب أنا إيه لازمتها تظهر لي وأنا مش مسموح لي بحاجة؟» — the home unit is folded into the
    // catalog so a grant written there is never lost, but where the caller can grant nothing and
    // the account holds nothing, the row would say only «مش مسموح لك». That is the greyed row the
    // owner threw out, wearing a location for a label.
    const merged = withSavedUnits(CATALOG, [], {
      branchId: 'D',
      departmentId: 'd8',
      branchName: { ar: 'المعادي', en: 'Maadi' },
      departmentName: { ar: 'العمليات', en: 'Operations' },
    });
    // Still merged into the CATALOG — dropping it there would lose a grant written later…
    expect(merged.catalog.branches.map((b) => b.id)).toContain('D');
    // …and still absent from the TREE, which is what the screen draws.
    expect(tree({}, {}, merged).map((b) => b.id)).not.toContain('D');
  });

  it('keeps that same placement the moment the account holds anything there', () => {
    // The other half of the rule, and the reason the fold-in exists at all: this is not «a place I
    // have no access to», it is a grant on the person in front of the reader.
    const merged = withSavedUnits(CATALOG, [grant('D', 'd8')], {
      branchId: 'D',
      departmentId: 'd8',
      branchName: { ar: 'المعادي', en: 'Maadi' },
      departmentName: { ar: 'العمليات', en: 'Operations' },
    });
    const d = branchOf(tree({}, { 'D:d8': ['employee.view'] }, merged), 'D');
    expect(d.departments.map((x) => x.id)).toEqual(['d8']);
    expect(d.departments[0]?.actionsOn).toBe(1);
    // …and it is still not the caller's to change, which is a different fact from not drawing it.
    expect(d.departments[0]?.editable).toBe(false);
  });

  it('gives a unit it invented nothing to grant, whatever its branch offers', () => {
    // d9 was soft-deleted after a grant was written on it, so the catalog no longer lists it.
    // Inheriting branch A's whole-branch keys would draw it as an ordinary editable row and
    // produce a PUT the server answers «Unknown department», taking the rest of the save with it.
    const merged = withSavedUnits(CATALOG, [grant('A', 'd9')], null);
    expect(merged.readOnly.has('A:d9')).toBe(true);
    const d9 = branchOf(tree({}, { 'A:d9': ['employee.view'] }, merged), 'A').departments.find(
      (d) => d.id === 'd9',
    );
    expect(d9?.ceiling.size).toBe(0);
    expect(d9?.editable).toBe(false);
  });

  it('puts the account’s own branch and department first', () => {
    const merged = withSavedUnits(CATALOG, [], { branchId: 'B', departmentId: 'd3' });
    expect(merged.catalog.branches.map((b) => b.id)).toEqual(['B', 'A']);
    const both = withSavedUnits(CATALOG, [], { branchId: 'A', departmentId: 'd2' });
    expect(both.catalog.branches[0]?.departments.map((d) => d.id)).toEqual(['d2', 'd1']);
  });

  it('does not duplicate a unit the catalog already offers', () => {
    const merged = withSavedUnits(CATALOG, [grant('A', 'd1')], { branchId: 'A', departmentId: 'd1' });
    expect(merged.catalog.branches.filter((b) => b.id === 'A')).toHaveLength(1);
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
