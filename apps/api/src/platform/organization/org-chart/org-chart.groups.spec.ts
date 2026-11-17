import { describe, expect, it } from 'vitest';
import {
  indexOrgChart,
  toOrgChartDto,
  type ChartInput,
  type ChartRow,
  type ChartSectionRow,
} from './org-chart.groups';

let seq = 0;
const at = (n: number): Date => new Date(Date.UTC(2026, 0, 1, 0, n));
const id = (): string => (++seq).toString(16).padStart(24, '0');

const BRANCHES = Array.from({ length: 7 }, (_, i) => ({ id: `b${i}`, name: { ar: `فرع ${i}`, en: `Branch ${i}` } }));

const row = (over: Partial<ChartRow> & Pick<ChartRow, 'branchId'>): ChartRow => ({
  id: id(),
  code: `DEP-${seq}`,
  name: { ar: 'العمليات', en: 'Operations' },
  catalogId: null,
  status: 'active',
  createdAt: at(seq),
  ...over,
});

const sectionRow = (over: Partial<ChartSectionRow> & Pick<ChartSectionRow, 'branchId' | 'departmentId'>): ChartSectionRow => ({
  ...row({ branchId: over.branchId }),
  name: { ar: 'الخزينة', en: 'Treasury' },
  ...over,
});

const empty = (): ChartInput => ({
  departmentRows: [],
  sectionRows: [],
  departmentEntries: [],
  sectionEntries: [],
  branches: BRANCHES,
  jobs: [],
  places: [],
});

describe('the org chart read model (P-ORG-3 §4)', () => {
  it('seven branch copies of one department are one tile, including an unlinked copy that folds in', () => {
    const ops = { id: id(), code: 'DEP-1', name: { ar: 'العمليات', en: 'Operations' }, status: 'active' as const, version: 0 };
    const input = empty();
    input.departmentEntries = [ops];
    input.departmentRows = [
      ...BRANCHES.slice(0, 6).map((b) => row({ branchId: b.id, catalogId: ops.id })),
      // Created later through the form, spelled differently, never linked.
      row({ branchId: 'b6', name: { ar: 'العمليات ', en: 'Ops' } }),
    ];
    const dto = toOrgChartDto(input);
    expect(dto.departments).toHaveLength(1);
    expect(dto.departments[0]?.key).toBe(`catalog:${ops.id}`);
    expect(dto.departments[0]?.branches).toHaveLength(7);
    // «إضافة قسم» may tick only the six whose row is linked (§5.3).
    expect(dto.departments[0]?.linkedBranchIds).toHaveLength(6);
    expect(dto.departments[0]?.linkedBranchIds).not.toContain('b6');
  });

  it('folds sections inside their department, so one name under two departments is two sections', () => {
    const ops = { id: id(), code: 'DEP-1', name: { ar: 'العمليات', en: 'Operations' }, status: 'active' as const, version: 0 };
    const sec = { id: id(), code: 'DEP-2', name: { ar: 'الأمن', en: 'Security' }, status: 'active' as const, version: 0 };
    const opsRow = row({ branchId: 'b0', catalogId: ops.id });
    const secRow = row({ branchId: 'b0', catalogId: sec.id, name: sec.name });
    const input = empty();
    input.departmentEntries = [ops, sec];
    input.departmentRows = [opsRow, secRow];
    input.sectionRows = [
      sectionRow({ branchId: 'b0', departmentId: opsRow.id, name: { ar: 'الإدارة', en: 'Admin' } }),
      sectionRow({ branchId: 'b0', departmentId: secRow.id, name: { ar: 'الاداره', en: 'Admin' } }),
    ];
    const dto = toOrgChartDto(input);
    const sectionsOf = (name: string) => dto.departments.find((d) => d.name.en === name)?.sections ?? [];
    expect(sectionsOf('Operations')).toHaveLength(1);
    expect(sectionsOf('Security')).toHaveLength(1);
    // Neither has a section entry: both are read-only name groups.
    expect(sectionsOf('Operations')[0]?.editable).toBe(false);
  });

  it('a department with no catalog entry is shown read-only', () => {
    const input = empty();
    input.departmentRows = [row({ branchId: 'b0', name: { ar: 'قسم جديد', en: 'New' } })];
    const [department] = toOrgChartDto(input).departments;
    expect(department?.departmentCatalogId).toBeNull();
    expect(department?.editable).toBe(false);
    expect(department?.key.startsWith('name:')).toBe(true);
  });

  it('a department whose entry is stopped is shown but not editable', () => {
    const ops = { id: id(), code: 'DEP-1', name: { ar: 'العمليات', en: 'Operations' }, status: 'inactive' as const, version: 2 };
    const input = empty();
    input.departmentEntries = [ops];
    input.departmentRows = [row({ branchId: 'b0', catalogId: ops.id })];
    const [department] = toOrgChartDto(input).departments;
    expect(department?.editable).toBe(false);
  });

  it('a stopped section is hidden, and the places in it come back with shown:false', () => {
    const ops = { id: id(), code: 'DEP-1', name: { ar: 'العمليات', en: 'Operations' }, status: 'active' as const, version: 0 };
    const treasury = { id: id(), code: 'SEC-1', name: { ar: 'الخزينة', en: 'Treasury' }, status: 'inactive' as const, version: 1, departmentCatalogId: ops.id };
    const opsRow = row({ branchId: 'b0', catalogId: ops.id });
    const input = empty();
    input.departmentEntries = [ops];
    input.sectionEntries = [treasury];
    input.departmentRows = [opsRow];
    input.sectionRows = [sectionRow({ branchId: 'b0', departmentId: opsRow.id, catalogId: treasury.id, status: 'inactive' })];
    input.jobs = [{ id: 'j1', code: 'J1', name: { ar: 'أمين خزينة', en: 'Cashier' }, version: 4 }];
    input.places = [
      { id: 'p1', jobTitleId: 'j1', departmentCatalogId: ops.id, sectionCatalogId: treasury.id },
      { id: 'p2', jobTitleId: 'j1', departmentCatalogId: ops.id, sectionCatalogId: null },
    ];
    const dto = toOrgChartDto(input);
    expect(dto.departments[0]?.sections).toHaveLength(0);
    expect(dto.jobs[0]?.places).toEqual([
      { departmentCatalogId: ops.id, sectionCatalogId: treasury.id, shown: false },
      { departmentCatalogId: ops.id, sectionCatalogId: null, shown: true },
    ]);
    expect(dto.jobs[0]?.version).toBe(4);
  });

  it('a department whose rows are all stopped is not a tile', () => {
    const input = empty();
    input.departmentRows = [row({ branchId: 'b0', status: 'inactive' })];
    expect(toOrgChartDto(input).departments).toHaveLength(0);
  });

  it('a section entry of another department is never editable under this one', () => {
    const ops = { id: id(), code: 'DEP-1', name: { ar: 'العمليات', en: 'Operations' }, status: 'active' as const, version: 0 };
    const other = { id: id(), code: 'DEP-2', name: { ar: 'الأمن', en: 'Security' }, status: 'active' as const, version: 0 };
    const stray = { id: id(), code: 'SEC-1', name: { ar: 'الخزينة', en: 'Treasury' }, status: 'active' as const, version: 0, departmentCatalogId: other.id };
    const opsRow = row({ branchId: 'b0', catalogId: ops.id });
    const input = empty();
    input.departmentEntries = [ops, other];
    input.sectionEntries = [stray];
    input.departmentRows = [opsRow];
    input.sectionRows = [sectionRow({ branchId: 'b0', departmentId: opsRow.id, catalogId: stray.id })];
    const index = indexOrgChart(input);
    expect(index.departments[0]?.sections[0]?.editable).toBe(false);
    // …and a place naming that entry under Operations is not shown there.
    expect(index.placeShown({ departmentCatalogId: ops.id, sectionCatalogId: stray.id })).toBe(false);
  });
});
