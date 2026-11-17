// The org chart's reads (P-ORG-3 §4): the whole chart, and a page of jobs' places named for their
// DTOs. Both go through ONE load and ONE fold, so the chart and the job form can never disagree about
// whether a place is shown.
import { type JobTitlePlaceDto, type OrgChartDto } from '@ecms/contracts';
import { indexOrgChart, toOrgChartDto } from './org-chart.groups';
import { loadOrgChart } from './org-chart.load';

export const orgChartService = {
  async chart(): Promise<OrgChartDto> {
    return toOrgChartDto(await loadOrgChart());
  },

  /**
   * Each job's places, named from the catalog entries, for `JobTitleDto.places`. One load for the
   * whole page (§4.3), never one per job.
   */
  async placesOf(jobIds: readonly string[]): Promise<Map<string, JobTitlePlaceDto[]>> {
    const out = new Map<string, JobTitlePlaceDto[]>(jobIds.map((id) => [id, []]));
    if (jobIds.length === 0) return out;
    const input = await loadOrgChart({ jobIds });
    const index = indexOrgChart(input);
    const departmentNames = new Map(input.departmentEntries.map((entry) => [entry.id, entry.name]));
    const sectionNames = new Map(input.sectionEntries.map((entry) => [entry.id, entry.name]));
    const wanted = new Set(jobIds);
    for (const place of input.places) {
      if (!wanted.has(place.jobTitleId)) continue;
      const list = out.get(place.jobTitleId) ?? [];
      list.push({
        id: place.id,
        department: {
          departmentCatalogId: place.departmentCatalogId,
          name: departmentNames.get(place.departmentCatalogId) ?? { ar: '', en: '' },
        },
        section:
          place.sectionCatalogId === null
            ? null
            : {
                sectionCatalogId: place.sectionCatalogId,
                name: sectionNames.get(place.sectionCatalogId) ?? { ar: '', en: '' },
              },
        shown: index.placeShown(place),
      });
      out.set(place.jobTitleId, list);
    }
    for (const list of out.values()) {
      list.sort(
        (a, b) =>
          a.department.name.ar.localeCompare(b.department.name.ar, 'ar') ||
          (a.section?.name.ar ?? '').localeCompare(b.section?.name.ar ?? '', 'ar'),
      );
    }
    return out;
  },
};

/** The labels an audit entry records for a job's places: «العمليات › الخزينة», sorted. */
export const placeLabels = (places: readonly JobTitlePlaceDto[]): string[] =>
  places
    .map((place) =>
      place.section === null ? place.department.name.ar : `${place.department.name.ar} › ${place.section.name.ar}`,
    )
    .sort((a, b) => a.localeCompare(b, 'ar'));
