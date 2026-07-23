// Electronic Employee File feature api/ surface (ADR-013). Endpoints match the backend contract
// exactly (`/hr/employee-files`). The file assembles once an employee's hiring documents are
// complete; it links the recruitment history and carries the Employee Timeline. No new backend API.
import {
  type AddEmployeeFileNote,
  type CreateEmployeeFile,
  type EmployeeFileDto,
  type Paginated,
} from '@ecms/contracts';
import { api, buildQuery, get, getPage, post, upload } from '../../../../../shared/lib/api-client';

export type EmployeeFileListParams = Record<string, string | number | boolean | undefined | null>;

export const listEmployeeFiles = (params: EmployeeFileListParams): Promise<Paginated<EmployeeFileDto>> =>
  getPage<EmployeeFileDto>(`/hr/employee-files${buildQuery(params)}`);

export const getEmployeeFile = (id: string): Promise<EmployeeFileDto> =>
  get<EmployeeFileDto>(`/hr/employee-files/${id}`);

export const createEmployeeFile = (body: CreateEmployeeFile): Promise<EmployeeFileDto> =>
  post<EmployeeFileDto>('/hr/employee-files', body);

export const addEmployeeFileNote = (id: string, body: AddEmployeeFileNote): Promise<EmployeeFileDto> =>
  post<EmployeeFileDto>(`/hr/employee-files/${id}/notes`, body);

/** Upload an additional CUSTOM document (independent of the hiring documents). */
export const uploadEmployeeFileDocument = (
  id: string,
  file: File,
  name: string,
  version: number,
): Promise<EmployeeFileDto> => {
  const form = new FormData();
  form.append('file', file);
  form.append('name', name);
  form.append('version', String(version));
  return upload<EmployeeFileDto>(`/hr/employee-files/${id}/documents`, form);
};

/** Remove a document (its independent copy/upload only — never the original hiring document). */
export const removeEmployeeFileDocument = (
  id: string,
  documentId: string,
  version: number,
): Promise<EmployeeFileDto> =>
  api<EmployeeFileDto>(`/hr/employee-files/${id}/documents/${documentId}`, {
    method: 'DELETE',
    body: JSON.stringify({ version }),
  });
