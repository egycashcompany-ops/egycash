// TanStack Query hooks for the Employees feature (ADR-013). Reads cached by the shared key factory;
// the create write seeds the new detail cache and invalidates only the list subtree. The accepted-
// offer lookup reuses the Job Offer list API (search + status:'accepted'); the org/manager reference
// resolution reuses the Job Offer feature's hooks/component — no new backend API is introduced.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type CreateEmployee, type EmployeeDto } from '@ecms/contracts';
import { detailKey, listKey } from '../../../../../shared/lib/query-keys';
import { listJobOffers } from '../../job-offers/api/job-offer-api';
import * as api from './employee-api';
import { type EmployeeListParams } from './employee-api';

const MODULE = 'hr';
const FEATURE = 'employees';

export const useEmployees = (params: EmployeeListParams) =>
  useQuery({
    queryKey: listKey(MODULE, FEATURE, params),
    queryFn: () => api.listEmployees(params),
    placeholderData: (prev) => prev,
  });

export const useEmployee = (id: string) =>
  useQuery({
    queryKey: detailKey(MODULE, FEATURE, id),
    queryFn: () => api.getEmployee(id),
    enabled: id !== '',
  });

/** Accepted-offer lookup for the create flow (reuses the Job Offer list API). */
export const useAcceptedOfferSearch = (term: string) =>
  useQuery({
    queryKey: [MODULE, 'jobOffers', 'search', 'accepted', term],
    queryFn: () => listJobOffers({ search: term, status: 'accepted', pageSize: 8 }),
    enabled: term.trim().length >= 2,
    staleTime: 30_000,
    select: (page) => page.items,
  });

export const useCreateEmployee = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateEmployee) => api.createEmployee(body),
    onSuccess: (created: EmployeeDto) => {
      qc.setQueryData(detailKey(MODULE, FEATURE, created.id), created);
      void qc.invalidateQueries({ queryKey: listKey(MODULE, FEATURE) });
    },
  });
};
