// The org chart's board and tiles, rendered (P-ORG-3 §2.1, §2.2).
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { type OrgChartDepartmentDto, type OrgChartJobDto } from '@ecms/contracts';
import { localeSlice } from '../../../../store/localeSlice';
import { columnsOf } from '../lib/chart-model';
import { ChartBoard, type ChartActions } from './ChartBoard';
import { DepartmentTiles } from './DepartmentTiles';

const OPS = 'a'.repeat(24);
const TREASURY = 'c'.repeat(24);

const ops: OrgChartDepartmentDto = {
  key: `catalog:${OPS}`,
  departmentCatalogId: OPS,
  editable: true,
  name: { ar: 'العمليات', en: 'Operations' },
  branches: [{ id: 'b1', name: { ar: 'طنطا', en: 'Tanta' } }],
  linkedBranchIds: ['b1'],
  sections: [
    {
      key: `catalog:${TREASURY}`,
      sectionCatalogId: TREASURY,
      editable: true,
      name: { ar: 'الخزينة', en: 'Treasury' },
      branches: [],
      catalogVersion: 0,
    },
    {
      key: 'name:قديم',
      sectionCatalogId: null,
      editable: false,
      name: { ar: 'قسم قديم', en: 'Old section' },
      branches: [],
      catalogVersion: null,
    },
  ],
};
const movement: OrgChartDepartmentDto = {
  ...ops,
  key: 'catalog:m',
  departmentCatalogId: 'e'.repeat(24),
  name: { ar: 'الحركة', en: 'Movement' },
  sections: [],
};
const legacy: OrgChartDepartmentDto = {
  ...movement,
  key: 'name:قديمة',
  departmentCatalogId: null,
  editable: false,
  name: { ar: 'إدارة قديمة', en: 'Legacy' },
};

const jobs: OrgChartJobDto[] = [
  {
    id: 'j1',
    code: 'J1',
    name: { ar: 'أمين خزينة', en: 'Cashier' },
    version: 1,
    places: [{ departmentCatalogId: OPS, sectionCatalogId: TREASURY, shown: true }],
  },
  {
    id: 'j2',
    code: 'J2',
    name: { ar: 'مدير العمليات', en: 'Ops manager' },
    version: 1,
    places: [{ departmentCatalogId: OPS, sectionCatalogId: null, shown: true }],
  },
  {
    id: 'j3',
    code: 'J3',
    name: { ar: 'سائق', en: 'Driver' },
    version: 1,
    places: [{ departmentCatalogId: 'e'.repeat(24), sectionCatalogId: null, shown: true }],
  },
];

const noop = (): void => undefined;
const actions = (over: Partial<ChartActions> = {}): ChartActions => ({
  canPlace: true,
  canAddSection: true,
  canEditSection: true,
  busy: false,
  onMove: noop,
  onRemove: noop,
  onAddJob: noop,
  onAddSection: noop,
  onRename: noop,
  onStop: noop,
  ...over,
});

const render = (node: JSX.Element): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: { locale: { locale: 'ar' as const, dir: 'rtl' as const } },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <MemoryRouter>{node}</MemoryRouter>
    </Provider>,
  );
};

const board = (
  department: OrgChartDepartmentDto,
  editing: boolean,
  over?: Partial<ChartActions>,
): string =>
  render(
    <ChartBoard
      department={department}
      columns={columnsOf(department, jobs)}
      editing={editing}
      actions={actions(over)}
      locale="ar"
    />,
  );

describe('the org chart board', () => {
  it("draws the department, its sections, each section's jobs, and the direct column", () => {
    const html = board(ops, false);
    expect(html).toContain('العمليات');
    expect(html).toContain('الخزينة');
    expect(html).toContain('أمين خزينة');
    expect(html).toContain('تابعة للإدارة مباشرة');
    expect(html).toContain('مدير العمليات');
    // A section not linked to the company list says it cannot be edited here.
    expect(html).toContain('غير مربوط بقائمة الشركة');
  });

  it("hangs a department's jobs directly under it when it has no sections", () => {
    const html = board(movement, false);
    expect(html).toContain('سائق');
    expect(html).not.toContain('تابعة للإدارة مباشرة');
  });

  it('shows the edit controls only in edit mode, and only for the keys held', () => {
    expect(board(ops, false)).not.toContain('إضافة وظيفة');
    const full = board(ops, true);
    expect(full).toContain('إضافة وظيفة');
    expect(full).toContain('إضافة قسم');
    expect(full).toContain('تغيير الاسم');
    expect(full).toContain('draggable="true"');
    const sectionsOnly = board(ops, true, { canPlace: false });
    expect(sectionsOnly).not.toContain('إضافة وظيفة');
    expect(sectionsOnly).toContain('إضافة قسم');
    const placesOnly = board(ops, true, { canAddSection: false, canEditSection: false });
    expect(placesOnly).toContain('إضافة وظيفة');
    expect(placesOnly).not.toContain('تغيير الاسم');
  });

  it('offers no edit at all under a department not linked to the company list', () => {
    const html = board({ ...legacy, sections: [] }, true);
    expect(html).not.toContain('إضافة وظيفة');
    expect(html).not.toContain('إضافة قسم');
  });

  it('waits while a change is on its way: nothing can be dragged or sent', () => {
    const html = board(ops, true, { busy: true });
    expect(html).not.toContain('draggable="true"');
  });

  it('draws the phone tree beside the desktop tree', () => {
    const html = board(ops, false);
    expect(html).toContain('sm:hidden');
    expect(html).toContain('hidden overflow-x-auto sm:block');
  });
});

describe('the department tiles', () => {
  const tiles = (selectedKey: string): string =>
    render(
      <DepartmentTiles
        departments={[ops, movement, legacy]}
        jobCounts={new Map([[ops.key, 2]])}
        selectedKey={selectedKey}
        onSelect={noop}
        search=""
        onSearch={noop}
        locale="ar"
      />,
    );

  it("marks the picked tile pressed, and counts each department's sections and jobs", () => {
    const html = tiles(ops.key);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toContain('2 أقسام');
    expect(html).toContain('2 وظائف');
    expect(html).toContain('بدون أقسام');
  });

  it('tags a department not linked to the company list', () => {
    expect(tiles(ops.key)).toContain('غير مربوطة');
  });
});
