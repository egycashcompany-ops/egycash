// "How many candidates have applied, across every platform" — one of the four numbers above the
// sources table.
//
// It is the applicants list's own `meta.totalItems`, asked for with a page size of one: the
// endpoint already counts the collection to build that field, so the count is free and the rows
// are not fetched. No counting endpoint was added for a number the API already returns.
import { useQuery } from '@tanstack/react-query';
import { type ApplicantDto } from '@ecms/contracts';
import { getPage } from '../../../../../shared/lib/api-client';

export const useApplicantTotal = () =>
  useQuery({
    queryKey: ['hr', 'applicants', 'total'] as const,
    queryFn: async () => (await getPage<ApplicantDto>('/hr/applicants?page=1&pageSize=1')).meta.totalItems,
    staleTime: 60_000,
  });
