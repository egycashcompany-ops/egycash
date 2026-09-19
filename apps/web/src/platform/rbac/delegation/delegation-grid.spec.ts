// The rules behind one site's table, checked directly — a tick that quietly reached a key the
// manager may not grant would produce a save the server refuses, and no render would show it.
import { describe, expect, it } from 'vitest';
import { type DelegationCatalogDto, type PermissionDto } from '@ecms/contracts';
import {
  buildRows,
  defaultSelection,
  pageState,
  sameSelection,
  summarize,
  toggleKey,
  togglePage,
} from './delegation-grid';

const p = (key: string, pageId: string | null): PermissionDto => ({
  key,
  resource: key.split('.')[0] ?? key,
  action: key.split('.')[1] ?? '',
  moduleId: 'hr',
  name: { ar: key, en: key },
  breakGlass: false,
  pageId,
});

const catalog: DelegationCatalogDto = {
  branches: [
    { id: 'A', name: { ar: 'أ', en: 'A' }, permissionKeys: ['employee.view', 'employee.edit', 'attendance.view'] },
  ],
  pages: [
    { id: 'hr.employees', moduleId: 'hr', name: { ar: 'الموظفين', en: 'Employees' }, route: '/employees', sortOrder: 1 },
    { id: 'hr.attendance', moduleId: 'hr', name: { ar: 'الحضور', en: 'Attendance' }, route: '/attendance', sortOrder: 2 },
  ],
  permissions: [
    p('employee.edit', 'hr.employees'),
    p('employee.view', 'hr.employees'),
    p('attendance.view', 'hr.attendance'),
    p('attendance.approve', 'hr.attendance'),
  ],
};
const CEILING = new Set(['employee.view', 'employee.edit', 'attendance.view']);

describe('buildRows', () => {
  it('groups by the registry page, «view» first, and shows granted keys the manager cannot grant', () => {
    const rows = buildRows(catalog, CEILING, new Set(['attendance.approve', 'ghost.key']));
    expect(rows.map((r) => r.page?.id ?? null)).toEqual(['hr.employees', 'hr.attendance', null]);
    expect(rows[0]?.keys.map((k) => k.key)).toEqual(['employee.view', 'employee.edit']);
    // Granted here by somebody with more authority: present, so it can be seen (and removed).
    expect(rows[1]?.keys.map((k) => k.key)).toEqual(['attendance.view', 'attendance.approve']);
    // A key the registry no longer knows still shows, under «other», named by its key.
    expect(rows[2]?.keys[0]?.name.en).toBe('ghost.key');
  });

  it('omits a page with nothing grantable and nothing granted', () => {
    const rows = buildRows(catalog, new Set(['employee.view']), new Set());
    expect(rows.map((r) => r.page?.id)).toEqual(['hr.employees']);
  });
});

describe('ticking', () => {
  const rows = buildRows(catalog, CEILING, new Set());
  const employees = rows[0]!;
  const attendance = rows[1]!;

  it('a new site starts with everything the manager may grant there', () => {
    expect([...defaultSelection(CEILING)].sort()).toEqual(['attendance.view', 'employee.edit', 'employee.view']);
  });

  it('a locked key cannot be ticked', () => {
    const rowsWithLocked = buildRows(catalog, CEILING, new Set(['attendance.approve']));
    const att = rowsWithLocked[1]!;
    expect(toggleKey(new Set(), 'attendance.approve', att, CEILING).has('attendance.approve')).toBe(false);
  });

  it('clearing «view» clears the screen — but not a locked key on it', () => {
    const rowsWithLocked = buildRows(catalog, CEILING, new Set(['attendance.approve']));
    const att = rowsWithLocked[1]!;
    const on = new Set(['attendance.view', 'attendance.approve']);
    const off = toggleKey(on, 'attendance.view', att, CEILING);
    expect(off.has('attendance.view')).toBe(false);
    expect(off.has('attendance.approve')).toBe(true);
  });

  it('the screen box ticks all grantable keys, then clears them; locked keys stay put', () => {
    const rowsWithLocked = buildRows(catalog, CEILING, new Set(['attendance.approve']));
    const att = rowsWithLocked[1]!;
    const all = togglePage(new Set(['attendance.approve']), att, CEILING);
    // Something was on, so the page CLEARS — and the locked key survives the clear.
    expect([...all]).toEqual(['attendance.approve']);
    const ticked = togglePage(new Set(), employees, CEILING);
    expect([...ticked].sort()).toEqual(['employee.edit', 'employee.view']);
  });

  it('reports the screen state over every key, locked ones included', () => {
    const rowsWithLocked = buildRows(catalog, CEILING, new Set(['attendance.approve']));
    const att = rowsWithLocked[1]!;
    expect(pageState(new Set(['attendance.view']), att)).toBe('some');
    expect(pageState(new Set(['attendance.view', 'attendance.approve']), att)).toBe('all');
    expect(pageState(new Set(), attendance)).toBe('none');
  });

  it('summarizes screens and actions, and knows when everything is on', () => {
    expect(summarize(rows, new Set(['employee.view']))).toEqual({ screens: 1, actions: 1, everything: false });
    expect(summarize(rows, CEILING)).toEqual({ screens: 2, actions: 3, everything: true });
    expect(sameSelection(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true);
    expect(sameSelection(new Set(['a']), new Set(['b']))).toBe(false);
  });
});
