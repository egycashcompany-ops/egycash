// The supplier register's calls (ADR-013), one typed function per endpoint
// `apps/api/src/modules/administration/procurement/suppliers/supplier.routes.ts` serves, and nothing
// else. No supplier is deleted: `isActive: false` on the PATCH retires one (§5.3). The one DELETE
// removes a paper's link from the supplier's list (§11.4).
//
// Every single-supplier answer is the detail — the record, its papers with their scan states, and
// the tax-number warning — so a write hands the screen the record's new version and its warning
// at once. A paper's bytes are guarded, so they are fetched with the session and shown through an
// object URL (IT's `CustodyReceipt.tsx` way): an `<img>` or an `<iframe>` cannot carry the token.
import {
  type AdministrationSupplierDetailDto,
  type AdministrationSupplierDto,
  type CreateAdministrationSupplier,
  type Paginated,
  type UpdateAdministrationSupplier,
} from '@ecms/contracts';
import {
  buildQuery,
  del,
  fetchBlob,
  get,
  getPage,
  patch,
  post,
  upload,
} from '../../../shared/lib/api-client';
import { type AdministrationListParams } from './catalog-api';

export const listSuppliers = (
  params: AdministrationListParams,
): Promise<Paginated<AdministrationSupplierDto>> =>
  getPage<AdministrationSupplierDto>(`/administration/suppliers${buildQuery(params)}`);

/** One supplier, retired or not — its record page and the resolve-by-id half of ADR-019 rule 5. */
export const getSupplier = (id: string): Promise<AdministrationSupplierDetailDto> =>
  get<AdministrationSupplierDetailDto>(`/administration/suppliers/${id}`);

export const createSupplier = (
  body: CreateAdministrationSupplier,
): Promise<AdministrationSupplierDetailDto> =>
  post<AdministrationSupplierDetailDto>('/administration/suppliers', body);

export const updateSupplier = (
  id: string,
  body: UpdateAdministrationSupplier,
): Promise<AdministrationSupplierDetailDto> =>
  patch<AdministrationSupplierDetailDto>(`/administration/suppliers/${id}`, body);

/** What filing a paper sends: the file, what the paper is, and the version it was decided on. */
export interface AddSupplierPaperInput {
  id: string;
  file: File;
  label: string;
  version: number;
}

/**
 * File a paper under the supplier. Multipart: the file part named `file`, with the text fields the
 * contract reads beside it — `label` and the supplier's `version`, because linking a paper is an
 * edit of the supplier (a moved version answers 409 `STALE_DOCUMENT`).
 */
export const addSupplierPaper = ({
  id,
  file,
  label,
  version,
}: AddSupplierPaperInput): Promise<AdministrationSupplierDetailDto> => {
  const form = new FormData();
  form.append('file', file);
  form.append('label', label);
  form.append('version', String(version));
  return upload<AdministrationSupplierDetailDto>(
    `/administration/suppliers/${id}/attachments`,
    form,
  );
};

/** Remove a paper's link — `?version=`, since a DELETE carries no body. */
export const removeSupplierPaper = ({
  id,
  attachmentId,
  version,
}: {
  id: string;
  attachmentId: string;
  version: number;
}): Promise<AdministrationSupplierDetailDto> =>
  del<AdministrationSupplierDetailDto>(
    `/administration/suppliers/${id}/attachments/${attachmentId}${buildQuery({ version })}`,
  );

/** A paper's bytes, under the supplier's read key (§11.5). */
export const fetchSupplierPaper = (id: string, attachmentId: string): Promise<Blob> =>
  fetchBlob(`/administration/suppliers/${id}/attachments/${attachmentId}`);
