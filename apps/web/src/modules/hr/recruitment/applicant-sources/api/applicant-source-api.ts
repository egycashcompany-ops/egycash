// The applicant-source catalog: the platforms candidates come from.
//
// The link belonging to each source is NOT here. A link lives on the intake form document, so
// publishing one goes through the form's own endpoints — see `recruitment-form-api`. Duplicating
// those calls would give the two screens two ways to publish the same link.
import {
  APPLICANT_SOURCE_ICON_FILE_CATEGORY,
  type ApplicantSourceDto,
  type CreateApplicantSource,
  type FileCategoryDto,
  type FileDto,
  type Paginated,
  type UpdateApplicantSource,
} from '@ecms/contracts';
import { getPage, patch, post, upload } from '../../../../../shared/lib/api-client';

export interface SourceListParams {
  page?: number;
  pageSize?: number;
  /** Only `key` and `createdAt` are sortable server-side (`sortableFields` on the service). */
  sortBy?: 'key' | 'createdAt';
  sortDir?: 'asc' | 'desc';
  kind?: string;
  active?: boolean;
  /**
   * Client-side. The endpoint has no text filter, so a search asks for the whole catalog and the
   * screen narrows it — see the note there.
   *
   * TODO: this is temporary. When the catalog outgrows one page, `/hr/applicant-sources` needs a
   * `search` parameter (name + key) and this should become another query string entry like the
   * two above. Until that exists, do NOT combine a term with server-side paging: the server would
   * page first and the browser would filter one page, so a match on page 3 would simply not
   * appear.
   */
  search?: string;
}

/**
 * The catalog, filtered and paged by the SERVER wherever the endpoint supports it: `kind`,
 * `active`, `page`, `pageSize`, `sortBy`, `sortDir` are all real query parameters
 * (`ListApplicantSourcesQuerySchema`), so a growing catalog does not become a growing download.
 *
 * `active` is only sent when the screen asks for one state. Omitting it is what returns disabled
 * sources alongside active ones, which this screen — unlike every other consumer — must show.
 *
 * `getPage`, not `get` — a list answers with the items in `data` and the paging in `meta`, and
 * `get` hands back only the former.
 */
export const listApplicantSources = (
  params: SourceListParams = {},
): Promise<Paginated<ApplicantSourceDto>> => {
  const query = new URLSearchParams({
    page: String(params.page ?? 1),
    pageSize: String(params.pageSize ?? 25),
    sortBy: params.sortBy ?? 'key',
    sortDir: params.sortDir ?? 'asc',
  });
  if (params.kind !== undefined && params.kind !== '') query.set('kind', params.kind);
  if (params.active !== undefined) query.set('active', String(params.active));
  return getPage<ApplicantSourceDto>(`/hr/applicant-sources?${query.toString()}`);
};

export const createApplicantSource = (body: CreateApplicantSource): Promise<ApplicantSourceDto> =>
  post<ApplicantSourceDto>('/hr/applicant-sources', body);

export const updateApplicantSource = (
  id: string,
  body: UpdateApplicantSource,
): Promise<ApplicantSourceDto> => patch<ApplicantSourceDto>(`/hr/applicant-sources/${id}`, body);

/**
 * The platform's icon, uploaded through the Files service and then referenced by the source.
 *
 * Deliberately NOT an endpoint of our own. `POST /platform/files` is the one intake for every file
 * in the system — it applies the category's mime and size rules, versions the object, records who
 * uploaded it and puts it behind the audited download path. A private upload route on this feature
 * would be a second way in that gets none of that for free, and the only thing it would save is
 * this lookup of the category id.
 */
export const uploadApplicantSourceIcon = async (
  sourceId: string,
  file: File,
): Promise<FileDto> => {
  const categories = await getPage<FileCategoryDto>('/platform/file-categories?pageSize=100');
  const category = categories.items.find((c) => c.key === APPLICANT_SOURCE_ICON_FILE_CATEGORY);
  if (category === undefined) {
    // Seeded at boot, so this means the API is older than this screen — say which piece is missing
    // rather than posting an upload that will be rejected for a reason nobody can read.
    throw new Error(`Missing file category "${APPLICANT_SOURCE_ICON_FILE_CATEGORY}"`);
  }
  const form = new FormData();
  form.append('file', file);
  form.append('moduleId', 'hr');
  form.append('entityType', 'applicantSource');
  form.append('entityId', sourceId);
  form.append('categoryId', category.id);
  form.append('displayName', file.name);
  return upload<FileDto>('/platform/files', form);
};
