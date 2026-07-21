// TanStack Query hooks for the Electronic Employee File feature (ADR-013). Reads cached by the
// shared key factory; each write returns the fresh file, so it seeds the detail cache and
// invalidates only the list subtree. The employee lookup reuses the Employees list API.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type AddEmployeeFileNote, type CreateEmployeeFile, type EmployeeFileDto } from '@ecms/contracts';
import { detailKey, listKey } from '../../../../../shared/lib/query-keys';
import { listEmployees } from '../../employees/api/employee-api';
import * as api from './employee-file-api';
import { type EmployeeFileListParams } from './employee-file-api';

const MODULE = 'hr';
const FEATURE = 'employeeFiles';

export const useEmployeeFiles = (params: EmployeeFileListParams) =>
  useQuery({
    queryKey: listKey(MODULE, FEATURE, params),
    queryFn: () => api.listEmployeeFiles(params),
    placeholderData: (prev) => prev,
  });

export const useEmployeeFile = (id: string) =>
  useQuery({
    queryKey: detailKey(MODULE, FEATURE, id),
    queryFn: () => api.getEmployeeFile(id),
    enabled: id !== '',
  });

/** Employee lookup for the create flow (reuses the Employees list API; the server requires the
 *  employee's hiring documents to be complete before a file can be assembled). */
export const useEmployeeSearch = (term: string) =>
  useQuery({
    queryKey: [MODULE, 'employees', 'search', term],
    queryFn: () => listEmployees({ search: term, pageSize: 8 }),
    enabled: term.trim().length >= 2,
    staleTime: 30_000,
    select: (page) => page.items,
  });

const useFileWriters = (id: string | null): { seedAndInvalidate: (updated: EmployeeFileDto) => void } => {
  const qc = useQueryClient();
  return {
    seedAndInvalidate: (updated) => {
      qc.setQueryData(detailKey(MODULE, FEATURE, id ?? updated.id), updated);
      void qc.invalidateQueries({ queryKey: listKey(MODULE, FEATURE) });
    },
  };
};

export const useCreateEmployeeFile = () => {
  const { seedAndInvalidate } = useFileWriters(null);
  return useMutation({
    mutationFn: (body: CreateEmployeeFile) => api.createEmployeeFile(body),
    onSuccess: seedAndInvalidate,
  });
};

export const useAddEmployeeFileNote = (id: string) => {
  const { seedAndInvalidate } = useFileWriters(id);
  return useMutation({
    mutationFn: (body: AddEmployeeFileNote) => api.addEmployeeFileNote(id, body),
    onSuccess: seedAndInvalidate,
  });
};
