// Electronic Employee File feature api/ surface (ADR-013). Endpoints match the backend contract
// exactly (`/hr/employee-files`). The file assembles once an employee's hiring documents are
// complete; it links the recruitment history and carries the Employee Timeline. No new backend API.
import {
  type AddEmployeeFileNote,
  type CreateEmployeeFile,
  type EmployeeFileDto,
  type Paginated,
} from '@ecms/contracts';
import { buildQuery, get, getPage, post } from '../../../../../shared/lib/api-client';

export type EmployeeFileListParams = Record<string, string | number | boolean | undefined | null>;

export const listEmployeeFiles = (params: EmployeeFileListParams): Promise<Paginated<EmployeeFileDto>> =>
  getPage<EmployeeFileDto>(`/hr/employee-files${buildQuery(params)}`);

export const getEmployeeFile = (id: string): Promise<EmployeeFileDto> =>
  get<EmployeeFileDto>(`/hr/employee-files/${id}`);

export const createEmployeeFile = (body: CreateEmployeeFile): Promise<EmployeeFileDto> =>
  post<EmployeeFileDto>('/hr/employee-files', body);

export const addEmployeeFileNote = (id: string, body: AddEmployeeFileNote): Promise<EmployeeFileDto> =>
  post<EmployeeFileDto>(`/hr/employee-files/${id}/notes`, body);
