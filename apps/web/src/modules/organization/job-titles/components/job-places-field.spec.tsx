// «مكانها في الهيكل التنظيمي» on the job form (P-ORG-3 §2.3).
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type OrgChartDto } from '@ecms/contracts';
import { localeSlice } from '../../../../store/localeSlice';
import { ORG_CHART_KEY } from '../../org-chart/org-chart-queries';
import { JobPlacesField, placeLabel, type PlaceRow } from './JobPlacesField';

const OPS = 'a'.repeat(24);
const TREASURY = 'c'.repeat(24);

const chart: OrgChartDto = {
  departments: [
    {
      key: `catalog:${OPS}`,
      departmentCatalogId: OPS,
      editable: true,
      name: { ar: 'العمليات', en: 'Operations' },
      branches: [],
      linkedBranchIds: [],
      sections: [
        { key: `catalog:${TREASURY}`, sectionCatalogId: TREASURY, editable: true, name: { ar: 'الخزينة', en: 'Treasury' }, branches: [], catalogVersion: 0 },
      ],
    },
  ],
  jobs: [],
};

const rows: PlaceRow[] = [
  { departmentCatalogId: OPS, sectionCatalogId: TREASURY, departmentName: { ar: 'العمليات', en: 'Operations' }, sectionName: { ar: 'الخزينة', en: 'Treasury' }, shown: true },
  { departmentCatalogId: OPS, sectionCatalogId: null, departmentName: { ar: 'العمليات', en: 'Operations' }, sectionName: null, shown: false },
];

const render = (value: PlaceRow[]): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: { locale: { locale: 'ar' as const, dir: 'rtl' as const } },
  });
  const client = new QueryClient();
  client.setQueryData(ORG_CHART_KEY, chart);
  return renderToStaticMarkup(
    <Provider store={store}>
      <QueryClientProvider client={client}>
        <JobPlacesField value={value} onChange={() => undefined} locale="ar" />
      </QueryClientProvider>
    </Provider>,
  );
};

describe('the job places field', () => {
  it('lists each place as «department › section», and tags a stopped one', () => {
    const html = render(rows);
    expect(html).toContain('العمليات › الخزينة');
    expect(html).toContain('العمليات › تابعة للإدارة مباشرة');
    expect(html).toContain('موقوف');
  });

  it('says «not set yet» when the job has no place', () => {
    expect(render([])).toContain('لم تُحدَّد بعد');
  });

  it('labels a place in either language', () => {
    expect(placeLabel(rows[0] as PlaceRow, 'en', 'Directly under the department')).toBe('Operations › Treasury');
    expect(placeLabel(rows[1] as PlaceRow, 'en', 'Directly under the department')).toBe(
      'Operations › Directly under the department',
    );
  });
});
