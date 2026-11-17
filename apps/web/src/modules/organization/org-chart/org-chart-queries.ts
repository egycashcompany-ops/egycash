// TanStack Query hooks for the org chart (P-ORG-3 §6.1). The chart and the job form read and write
// the same rows, so each side's writes refresh the other's queries: a section write puts the fresh
// chart straight into its key and refreshes the sections and departments lists; a job write patches
// the job's version and places into the chart (so the next gesture carries the current version) and
// refreshes the chart, the job pages and the job pickers.
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  type AddChartSection,
  type JobPlaceInput,
  type JobTitleDto,
  type OrgChartDto,
  type RenameChartSection,
  type StopChartSection,
} from '@ecms/contracts';
import { featureKey } from '../../../shared/lib/query-keys';
import { ORG_MODULE } from '../shared/org-unit-resource';
import { updateJobTitle } from '../job-titles/job-title-api';
import * as api from './org-chart-api';

export const ORG_CHART_KEY = [ORG_MODULE, 'org-chart'] as const;

export const useOrgChart = () => useQuery({ queryKey: ORG_CHART_KEY, queryFn: api.getOrgChart });

const afterSectionWrite = (qc: QueryClient, chart: OrgChartDto): void => {
  qc.setQueryData(ORG_CHART_KEY, chart);
  void qc.invalidateQueries({ queryKey: featureKey(ORG_MODULE, 'sections') });
  void qc.invalidateQueries({ queryKey: featureKey(ORG_MODULE, 'departments') });
};

/** After any job write, from the chart or the job form: the places changed in both views (§6.1). */
export const refreshAfterJobWrite = (qc: QueryClient, job?: JobTitleDto): void => {
  if (job !== undefined) {
    qc.setQueryData<OrgChartDto>(ORG_CHART_KEY, (chart) =>
      chart === undefined
        ? chart
        : {
            ...chart,
            jobs: chart.jobs.map((entry) =>
              entry.id !== job.id
                ? entry
                : {
                    ...entry,
                    version: job.version,
                    places: job.places.map((place) => ({
                      departmentCatalogId: place.department.departmentCatalogId,
                      sectionCatalogId: place.section?.sectionCatalogId ?? null,
                      shown: place.shown,
                    })),
                  },
            ),
          },
    );
  }
  void qc.invalidateQueries({ queryKey: ORG_CHART_KEY });
  void qc.invalidateQueries({ queryKey: featureKey(ORG_MODULE, 'jobTitles') });
  void qc.invalidateQueries({ queryKey: featureKey(ORG_MODULE, 'job-titles') });
};

export const useAddChartSection = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AddChartSection) => api.addChartSection(body),
    onSuccess: (chart) => afterSectionWrite(qc, chart),
  });
};

export const useRenameChartSection = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: RenameChartSection }) =>
      api.renameChartSection(id, body),
    onSuccess: (chart) => afterSectionWrite(qc, chart),
  });
};

export const useStopChartSection = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: StopChartSection }) =>
      api.stopChartSection(id, body),
    onSuccess: (chart) => afterSectionWrite(qc, chart),
  });
};

/** One change of a job's places from the chart: the job's whole set, through the job's own update. */
export const useChangeJobPlaces = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      version,
      places,
    }: {
      id: string;
      version: number;
      places: JobPlaceInput[];
    }) => updateJobTitle(id, { version, places }),
    onSuccess: (job) => refreshAfterJobWrite(qc, job),
  });
};
