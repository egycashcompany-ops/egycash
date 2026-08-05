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

/**
 * No `active` filter: the management screen is the one place that must show disabled ones too.
 *
 * `getPage`, not `get` — a list answers with the items in `data` and the paging in `meta`, and
 * `get` hands back only the former.
 */
export const listApplicantSources = (): Promise<Paginated<ApplicantSourceDto>> =>
  getPage<ApplicantSourceDto>('/hr/applicant-sources?pageSize=100&sortBy=key&sortDir=asc');

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
