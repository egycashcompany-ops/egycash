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
    places: [{ departmentCatalogId: OPS, sectionCatalogId: TREASURY, shown: true, position: null }],
  },
  {
    id: 'j2',
    code: 'J2',
    name: { ar: 'مدير العمليات', en: 'Ops manager' },
    version: 1,
    places: [{ departmentCatalogId: OPS, sectionCatalogId: null, shown: true, position: null }],
  },
  {
    id: 'j3',
    code: 'J3',
    name: { ar: 'سائق', en: 'Driver' },
    version: 1,
    places: [{ departmentCatalogId: 'e'.repeat(24), sectionCatalogId: null, shown: true, position: null }],
  },
];

const noop = (): void => undefined;
const actions = (over: Partial<ChartActions> = {}): ChartActions => ({
  canPlace: true,
  canAddSection: true,
  canEditSection: true,
  busy: false,
  onMove: noop,
  onReorder: noop,
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

// «لما باجي أشد حاجة عشان أغير ترتيبها مش بتتشد» (§5.7): the owner's own department — no sections,
// three jobs in one column.
describe('reordering a column', () => {
  const MARKETING = 'f'.repeat(24);
  const marketing: OrgChartDepartmentDto = {
    ...movement,
    key: `catalog:${MARKETING}`,
    departmentCatalogId: MARKETING,
    name: { ar: 'التسويق و التعاقدات', en: 'Marketing' },
    sections: [],
  };
  const at = (position: number | null) => [
    { departmentCatalogId: MARKETING, sectionCatalogId: null, shown: true, position },
  ];
  const three: OrgChartJobDto[] = [
    { id: 'm1', code: 'M1', name: { ar: 'اخصائى اول تسويق', en: 'Senior' }, version: 1, places: at(1) },
    { id: 'm2', code: 'M2', name: { ar: 'مدير التسويق', en: 'Manager' }, version: 1, places: at(0) },
    { id: 'm3', code: 'M3', name: { ar: 'استشارى تسويق', en: 'Consultant' }, version: 1, places: at(null) },
  ];
  const draw = (list: OrgChartJobDto[], editing = true): string =>
    render(
      <ChartBoard
        department={marketing}
        columns={columnsOf(marketing, list)}
        editing={editing}
        actions={actions()}
        locale="ar"
      />,
    );

  it('shows the saved order, and in edit mode a grip and ↑ / ↓ on every row', () => {
    const html = draw(three);
    const order = ['مدير التسويق', 'اخصائى اول تسويق', 'استشارى تسويق'].map((name) => html.indexOf(name));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // Desktop rows are draggable; each row of the desktop and the phone tree has the arrows.
    expect(html.match(/draggable="true"/g)).toHaveLength(3);
    expect(html.match(/aria-label="تحريك لأعلى"/g)).toHaveLength(6);
    expect(html.match(/aria-label="تحريك لأسفل"/g)).toHaveLength(6);
  });

  it('cannot move the first row up or the last one down', () => {
    const html = draw(three);
    const up = [...html.matchAll(/<button[^>]*aria-label="تحريك لأعلى"[^>]*>/g)].map((m) => m[0]);
    const down = [...html.matchAll(/<button[^>]*aria-label="تحريك لأسفل"[^>]*>/g)].map((m) => m[0]);
    // The attribute, not the `disabled:` styles every button carries in its class.
    expect(up[0]).toContain('disabled=""');
    expect(up[1]).not.toContain('disabled=""');
    expect(down[2]).toContain('disabled=""');
    expect(down[0]).not.toContain('disabled=""');
  });

  it('offers no grip and no arrows to a lone job with nowhere else to go', () => {
    const html = draw([three[0] as OrgChartJobDto]);
    expect(html).not.toContain('draggable="true"');
    expect(html).not.toContain('تحريك لأعلى');
    expect(html).not.toContain('↕');
  });

  it('offers no order controls in a section stopped in the company list (the server refuses them)', () => {
    const LOCKED = '9'.repeat(24);
    const withLocked: OrgChartDepartmentDto = {
      ...marketing,
      sections: [
        { key: `catalog:${LOCKED}`, sectionCatalogId: LOCKED, editable: false, name: { ar: 'موقوف', en: 'Stopped' }, branches: [], catalogVersion: 0 },
      ],
    };
    const inLocked = (id: string, name: string): OrgChartJobDto => ({
      id,
      code: id,
      name: { ar: name, en: name },
      version: 1,
      places: [{ departmentCatalogId: MARKETING, sectionCatalogId: LOCKED, shown: true, position: null }],
    });
    const html = render(
      <ChartBoard
        department={withLocked}
        columns={columnsOf(withLocked, [inLocked('l1', 'أ'), inLocked('l2', 'ب')])}
        editing
        actions={actions()}
        locale="ar"
      />,
    );
    expect(html).toContain('موقوف');
    expect(html).not.toContain('تحريك لأعلى');
  });

  it('shows no reorder controls outside edit mode', () => {
    const html = draw(three, false);
    expect(html).not.toContain('draggable="true"');
    expect(html).not.toContain('تحريك لأعلى');
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
