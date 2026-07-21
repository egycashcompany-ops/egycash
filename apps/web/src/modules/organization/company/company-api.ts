// Company (Organization singleton) api + query hooks. GET/PATCH `/platform/organization`
// (organization.view / organization.edit). The profile is version-checked like every other
// aggregate; the mutation seeds the cache from the fresh response.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type OrganizationDto, type UpdateOrganization } from '@ecms/contracts';
import { get, patch } from '../../../shared/lib/api-client';
import { ORG_MODULE } from '../shared/org-unit-resource';

const PROFILE_KEY = [ORG_MODULE, 'company', 'profile'];

const fetchOrganization = (): Promise<OrganizationDto> => get<OrganizationDto>('/platform/organization');

export const useOrganization = () =>
  useQuery({ queryKey: PROFILE_KEY, queryFn: fetchOrganization, staleTime: 60_000 });

export const useUpdateOrganization = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateOrganization) => patch<OrganizationDto>('/platform/organization', body),
    onSuccess: (doc) => qc.setQueryData(PROFILE_KEY, doc),
  });
};
