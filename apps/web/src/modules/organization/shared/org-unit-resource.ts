// A thin, typed CRUD surface + TanStack Query hooks shared by the three symmetric org units
// (Branch → Department → Section), mirroring the backend's `makeOrgUnitHandlers` factory (ADR-013).
// Each unit feature is a configured instance over this one implementation, so the list/detail/form
// screens stay generic. Reads are cached by the shared key factory; every write seeds the detail
// cache from the response and invalidates the feature subtree (minimal invalidation).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type Address, type OrgUnitDto, type Paginated } from '@ecms/contracts';
import { buildQuery, del, get, getPage, patch, post } from '../../../shared/lib/api-client';
import { detailKey, featureKey, listKey } from '../../../shared/lib/query-keys';

export const ORG_MODULE = 'organization';

/** Widened org-unit shape: the common fields plus the parent/address fields some units carry. */
export type AnyUnitDto = OrgUnitDto & {
  branchId?: string;
  departmentId?: string;
  address?: Address | null;
};

export type UnitListParams = Record<string, string | number | boolean | undefined | null>;

/** Bodies are assembled dynamically by the generic form and validated server-side (Zod). */
export type UnitBody = Record<string, unknown>;

export interface UnitApi<TDto extends AnyUnitDto> {
  list: (params: UnitListParams) => Promise<Paginated<TDto>>;
  get: (id: string) => Promise<TDto>;
  create: (body: UnitBody) => Promise<TDto>;
  update: (id: string, body: UnitBody) => Promise<TDto>;
  remove: (id: string) => Promise<void>;
}

export const makeUnitApi = <TDto extends AnyUnitDto>(resource: string): UnitApi<TDto> => ({
  list: (params) => getPage<TDto>(`/platform/${resource}${buildQuery(params)}`),
  get: (id) => get<TDto>(`/platform/${resource}/${id}`),
  create: (body) => post<TDto>(`/platform/${resource}`, body),
  update: (id, body) => patch<TDto>(`/platform/${resource}/${id}`, body),
  remove: (id) => del<void>(`/platform/${resource}/${id}`),
});

export const makeUnitQueries = <TDto extends AnyUnitDto>(feature: string, client: UnitApi<TDto>) => {
  const useList = (params: UnitListParams) =>
    useQuery({
      queryKey: listKey(ORG_MODULE, feature, params),
      queryFn: () => client.list(params),
      placeholderData: (prev) => prev,
    });

  const useOne = (id: string) =>
    useQuery({
      queryKey: detailKey(ORG_MODULE, feature, id),
      queryFn: () => client.get(id),
      enabled: id !== '',
    });

  const useCreate = () => {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (body: UnitBody) => client.create(body),
      onSuccess: (doc) => {
        qc.setQueryData(detailKey(ORG_MODULE, feature, doc.id), doc);
        void qc.invalidateQueries({ queryKey: featureKey(ORG_MODULE, feature) });
      },
    });
  };

  const useUpdate = (id: string) => {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (body: UnitBody) => client.update(id, body),
      onSuccess: (doc) => {
        qc.setQueryData(detailKey(ORG_MODULE, feature, doc.id), doc);
        void qc.invalidateQueries({ queryKey: featureKey(ORG_MODULE, feature) });
      },
    });
  };

  const useRemove = () => {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (id: string) => client.remove(id),
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: featureKey(ORG_MODULE, feature) });
      },
    });
  };

  return { useList, useOne, useCreate, useUpdate, useRemove };
};

export type UnitQueries<TDto extends AnyUnitDto> = ReturnType<typeof makeUnitQueries<TDto>>;
