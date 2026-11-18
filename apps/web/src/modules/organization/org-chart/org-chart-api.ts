// The company org chart (P-ORG-3). Job places are NOT written here: a change of places is the job's
// own update (`job-title-api.ts` → `PATCH /platform/job-titles/:id`), one write path for the chart and
// the job form alike (design §5.2). A column's ORDER is the chart's own arrangement and is (§5.7).
import {
  type AddChartSection,
  type OrderChartColumn,
  type OrgChartDto,
  type RenameChartSection,
  type StopChartSection,
} from '@ecms/contracts';
import { get, patch, post, put } from '../../../shared/lib/api-client';

const BASE = '/platform/org-chart';

export const getOrgChart = (): Promise<OrgChartDto> => get<OrgChartDto>(BASE);

/** «إضافة قسم» — answers with the whole fresh chart. */
export const addChartSection = (body: AddChartSection): Promise<OrgChartDto> =>
  post<OrgChartDto>(`${BASE}/sections`, body);

export const renameChartSection = (
  sectionCatalogId: string,
  body: RenameChartSection,
): Promise<OrgChartDto> => patch<OrgChartDto>(`${BASE}/sections/${sectionCatalogId}`, body);

export const stopChartSection = (
  sectionCatalogId: string,
  body: StopChartSection,
): Promise<OrgChartDto> => post<OrgChartDto>(`${BASE}/sections/${sectionCatalogId}/stop`, body);

/** A column's jobs in a new order (§5.7) — answers with the whole fresh chart. */
export const orderChartColumn = (body: OrderChartColumn): Promise<OrgChartDto> =>
  put<OrgChartDto>(`${BASE}/order`, body);
